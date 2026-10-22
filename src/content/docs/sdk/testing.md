---
title: Testing
description: Test a unit on your own machine with FakeHost, keep site checks portable, and verify a built DLL's exports.
---

Most of a unit is plain Rust that runs anywhere. Keep the Windows-only
parts (live memory, code writes) at the edge, and test everything else on
your build machine with `cargo test`.

## Build as `rlib` too

```toml
[lib]
crate-type = ["cdylib", "rlib"]
```

With `rlib`, `cargo test` links your unit's code into a normal test binary
for your machine. In test builds `ff13_unit!` does not export `init` and
`shutdown` under their plain names; call them by path.

## An in-memory host: `FakeHost`

`testing::FakeHost` is a complete host context whose services (log, merged
files, MinHook, storage, settings, save events) record into per-thread
state:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use workshop_ext_sdk::{abi, sites, testing::FakeHost, unit::run_init};

    #[test]
    fn starts_and_registers_its_menu() {
        let host = FakeHost::new(abi::GAME_XIII);
        let rc = unsafe { run_init(host.context(), |i| start(i, &image, &sites::NoForeignCode)) };
        assert_eq!(rc, 0);
        assert!(FakeHost::logged("hello: session 1"));
        assert!(FakeHost::query(ID).is_some());
    }

    #[test]
    fn refuses_other_games() {
        let host = FakeHost::new(abi::GAME_XIII_2);
        let rc = unsafe { run_init(host.context(), |i| start(i, &image, &sites::NoForeignCode)) };
        assert_eq!(rc, 1);
    }
}
```

Useful `FakeHost` functions:

| Function | Use |
| --- | --- |
| `FakeHost::new(game)`, `.context()` | a host context for `run_init` |
| `logged(text)`, `lines()` | what the unit logged |
| `add_file(path, bytes)` | a merged-container file for `read_file` |
| `hooks()`, `fail_hook_create_at(n)`, `fail_hook_enable_at(n)` | hook installs and failures |
| `regions()`, `seed_region(id, schema, bytes)`, `take_region(id)` | host storage |
| `query(id)`, `providers()` | registered settings providers |
| `fire(kind, slot)`, `deliver(&event)` | save events to registered handlers |
| `fail_services(...)`, `fail_flush(status)` | service errors |

State is per thread. The default test harness runs each test on its own
thread; a Cucumber runner should run scenarios one at a time.

## Portable site checks

Write `init` so the image reader and the memory policy are parameters (the
hello-unit example does this). Live builds pass the real image and
`win::LiveMemory`; tests pass a closure that serves the expected bytes and
`sites::NoForeignCode`. `testing::FakeMemory` models foreign detours when
you want to test the call/hook policy itself.

## Test the menu

Building `menu::descriptor()` in a test catches every malformed control
(duplicate IDs, bad ranges, too many controls). If you ship translations,
assert that `texts::problems(&required, CATALOG)` is empty.

## Check the built DLL

A unit must export exactly `init` and `shutdown`. From a clone of the SDK
repository:

```sh
cargo run -p workshop-ext-sdk --example export_check -- path/to/my_unit.dll
```

Or in your own test, with `workshop_ext_sdk::pe`:

```rust
let bytes = std::fs::read("target/i686-pc-windows-gnu/release/my_unit.dll")?;
let names = workshop_ext_sdk::pe::exports(&bytes).expect("a PE32 DLL");
assert!(workshop_ext_sdk::pe::is_unit(&names));
```

## In the game

- Install your shard with PulseDepot and read `Crux.jsonl` after starting
  the game. Your `init` log lines show whether the unit started or why it
  refused.
- Test on a copy of your saves first.
