---
title: Sites and hooks
description: Declare every game address a unit uses with its retail bytes, verify them all before touching anything, and install hooks all or nothing.
---

A unit works on fixed addresses in the game executable. Other builds of the
game, and other mods, can change what is at those addresses. The SDK's rule
is simple: **verify every address before touching anything, and fail
closed.**

## Declare sites

A *site* is a name, an RVA (offset from the image base) and the exact
retail bytes found there, plus what the unit does with it. Declare them all
in one table with `sites!`:

```rust
use workshop_ext_sdk::sites::{Site, SiteKind};

// Illustrative values: copy the real RVAs and bytes from the executable
// you verified.
workshop_ext_sdk::sites! {
    /// Every site the unit uses.
    pub const SITES = {
        "the function we call" @ 0x0001_0000 = [0x55, 0x8b, 0xec, 0x83, 0xec, 0x18], call;
        "the function we hook" @ 0x0002_0000 = b"\x55\x8b\xec\x51", hook;
        "a constant we patch"  @ 0x0003_0000 = [0x00, 0x80, 0x3b, 0x44], anchor;
    }
}
```

- The RVA is a literal, a named constant or a parenthesised expression.
- The bytes are an array literal, a byte string, the name of an array or
  slice constant, or `{ expr }` for any expression that coerces to `&[u8]`.
- A compile-time check rejects empty sites and sites longer than
  `sites::MAX_SITE_BYTES` (512).

## The policy: call, hook, anchor

Other components hook game functions too (Crux itself detours one game
function for its save events). What a unit accepts at a site depends on
what it does there:

| Kind | The unit… | Accepts |
| --- | --- | --- |
| `call` | only calls the function | the retail bytes, **or** another component's entry detour: a 5-byte `jmp rel32` or 6-byte `jmp [abs32]` at the entry, every later byte still retail, the destination outside the main image in committed executable memory. Calling through the detour is how hooks chain. |
| `hook` | hooks or redirects it | the retail bytes only. Another component's detour is reported as *occupied* and never overwritten. |
| `anchor` | reads or patches code or data by value | the retail bytes only. |

Anything else is a different executable: the unit must refuse to start.

## Verify in `init`

```rust
use workshop_ext_sdk::sites::{self, Finding};

fn verify_sites(init: &Init) -> Result<(), InitError> {
    let host = init.host();
    let image = host.image();
    // SAFETY: the host's image range is the mapped main executable.
    let read = |rva: u32, out: &mut [u8]| unsafe { image.read(rva, out) };
    let summary = sites::verify(SITES, image, &read, &workshop_ext_sdk::win::LiveMemory,
        &mut |site, finding| match finding {
            Finding::Problem(p) => host.error(format_args!(
                "my unit: {} @ RVA {:#x}: {p}", site.name, site.rva)),
            Finding::Foreign { jump, dest } => host.info(format_args!(
                "my unit: {} @ RVA {:#x}: foreign {} -> {dest:#x} accepted",
                site.name, site.rva, jump.text())),
        });
    if summary.passed() { Ok(()) } else { Err(InitError::REFUSED) }
}
```

- `sites::verify` checks every site and reports each problem and each
  accepted foreign detour. `Summary::passed()` is true only when every site
  was admitted.
- `sites::check` checks one site and returns its `Verdict` (`Retail` or
  `Foreign`) or a `Problem` (`OutsideImage`, `Bytes`, `Occupied`).
- `win::LiveMemory` (Windows only) asks the running process whether a
  detour's destination is committed executable memory.
  `sites::NoForeignCode` treats every detour as a mismatch: use it in
  tests and wherever the image is not mapped in your process.
- `Image::address(rva)` turns an RVA into an absolute address once
  verification passed.

## Install hooks

Crux provides MinHook through the host context. Hooks can only be
**created** during `init`; they can be enabled, disabled and removed later.

```rust
use core::sync::atomic::{AtomicUsize, Ordering};
use workshop_ext_sdk::hooks::HookSpec;

/// The trampoline: call it to run the original function.
static ORIGINAL: AtomicUsize = AtomicUsize::new(0);

// The detour must use the target's calling convention.
extern "C" fn detour(value: i32) -> i32 {
    // SAFETY: ORIGINAL holds the trampoline of a function with this signature.
    let original: extern "C" fn(i32) -> i32 =
        unsafe { core::mem::transmute(ORIGINAL.load(Ordering::Acquire)) };
    original(value) + 1
}

fn install(init: &Init) -> InitResult {
    let target = init.host().image().address(SITES[1].rva);
    init.install_hooks(&[HookSpec {
        target,
        detour: detour as extern "C" fn(i32) -> i32 as usize,
        original: &ORIGINAL,
    }])?; // HookFailure -> InitError::HOOK_FAILED
    Ok(())
}
```

`install_hooks` creates every hook (disabled), then enables every hook. On
the first failure it disables and removes every hook it created, resets each
`original` to 0 and returns a `HookFailure` (stage, target, host status,
hooks removed). A unit is either fully hooked or not at all.

Later, from any thread, `init.host().hooks()` (or a copy kept in a static)
returns a `HookControl` with `enable`, `disable` and `remove` for the hooks
your unit created. Crux refuses null targets and its own targets.

## Safety notes

- **Verify first.** Install nothing until every site passed. A unit that
  fails verification returns `REFUSED` and leaves the game as it was.
- **Match the calling convention.** Many game functions are member
  functions (`thiscall` on 32-bit x86). `extern "thiscall"` only exists on
  x86, so gate such code with `#[cfg(target_arch = "x86")]` if you also
  build tests on a 64-bit machine.
- **Hook paths run on the game's threads.** Do not allocate where you can
  avoid it, never block, and use atomics for shared values (see `Param` in
  [In-game settings](../settings/) and `log::Line` in
  [Logging](../logging/)).
- **Never let a panic cross into the game.** `ff13_unit!`, settings
  callbacks and save-event handlers catch panics for you. Your own detours
  do not: keep them panic-free, or wrap their body in
  `std::panic::catch_unwind`.
- **Code writes.** `Image::write` (and `win::write_code`) change verified
  bytes through a temporary writable window and flush the instruction
  cache. Use them only on `anchor` sites, and restore only bytes you wrote.
- **Unloading.** If a hook or patch cannot be removed safely while the
  game runs, call `win::pin_module` so Windows never unloads your DLL.
