---
title: Units and exports
description: What ff13_unit! generates, when Crux calls init and shutdown, what the init scope allows and which return codes mean what.
---

## The two exports

`workshop_ext_sdk::ff13_unit!` emits the unit's only two exports, both
`extern "C"` (cdecl):

```rust
fn start(init: &Init) -> InitResult { Ok(()) }
fn stop() {}

workshop_ext_sdk::ff13_unit! { init: start, shutdown: stop }
// shutdown is optional:
// workshop_ext_sdk::ff13_unit! { init: start }
```

- `init(context)` validates the host context, then calls your function
  with an [`Init`](#the-init-scope) scope. A panic in your function is
  caught, logged and returned as code 4; it never unwinds into the game.
- `shutdown()` calls your shutdown function, if any, with panics caught.

Do not add a `DllMain` with logic and do not export anything else. Crux
calls nothing but these two. The `export_check` tool verifies a built DLL
(see [Testing](../testing/)).

In your own test builds (`cfg(test)`) the two functions are not exported
under their plain names, so several units and the C library cannot clash.
Tests call them by path.

## When Crux calls them

| Phase | Constant | When `init` runs |
| --- | --- | --- |
| Early | `abi::PHASE_EARLY` | while the merged mod image loads, before the title screen |
| Late | `abi::PHASE_LATE` | at the first field idle |

You choose the phase when you add the DLL to a CrystalWorkshop project
(the **Late (first field idle)** box). `init` runs once, on Crux's loader
thread. On success the unit stays loaded for the life of the process. On
any nonzero return Crux logs it, unloads the unit and removes the hooks it
created.

## Checking the context

`Host` is a validated copy of the context Crux passed in. A null context,
another ABI version or a context smaller than the version 1 layout is
refused before any other field is read (`init` returns 1).

Describe what your unit needs with `Requirements` and check it first:

```rust
const NEEDS: Requirements = Requirements {
    game: Some(abi::GAME_XIII),           // or GAME_XIII_2, GAME_LR, None
    services: &[Service::Log, Service::HookCreate, Service::HookEnable,
                Service::HookDisable, Service::HookRemove],
    image: true,                          // the main executable is mapped
};

fn start(init: &Init) -> InitResult {
    let host = init.host();
    host.require(&NEEDS).map_err(|why| {
        host.error(format_args!("my unit: {why}"));
        InitError::UNUSABLE_CONTEXT
    })?;
    Ok(())
}
```

`Service::HOOKS` lists the four hook services in order. The check order is
ABI version, size, game, each listed service, then the image.

## The init scope

`Init` exists only during `init`. Some host services may only be used on
the thread running `init`, so the SDK hands them out from here:

| Method | Returns |
| --- | --- |
| `init.host()` | the `Host`: logging, game, phase, image, file reads |
| `init.install_hooks(&[HookSpec])` | creates and enables a whole hook set, or rolls it back ([Sites and hooks](../sites-and-hooks/)) |
| `init.hooks()` | the lower-level `HookFactory`, when all four hook services exist |
| `init.storage(id)` | a host storage `Region`, or `Ok(None)` without the service ([Storage](../per-save/)) |
| `init.settings()` | the settings registry, or `Ok(None)` ([Settings](../settings/)) |
| `init.save_events()` | the save events service, or `Ok(None)` ([Per-save state](../per-save/)) |

`Host` is `Copy` and stays valid for the process. To use it later, from a
hook or from `shutdown`, store it in a `HostSlot`:

```rust
static HOST: HostSlot = HostSlot::new();

fn start(init: &Init) -> InitResult {
    HOST.set(init.host());
    Ok(())
}

fn stop() {
    if let Some(host) = HOST.get() {
        host.info(format_args!("my unit: shutdown"));
    }
}
```

`Host` also reads files from the merged mod data: `host.file_size(path)`
and `host.read_file(path, max_bytes)`.

## Return codes

Return `Ok(())` for success, or an `InitError`:

| Code | `InitError` | Meaning |
| --- | --- | --- |
| 0 | (success) | initialized; the unit stays loaded |
| 1 | `UNUSABLE_CONTEXT` | null context, wrong ABI, game or missing service |
| 2 | `REFUSED` | the executable does not match the unit's sites, or a service it needs failed |
| 3 | `HOOK_FAILED` | creating or enabling a hook failed (everything was rolled back) |
| 4 | (panic) | the unit panicked during `init` |

`InitError::code(n)` makes any other nonzero code. `HookFailure` converts to
`HOOK_FAILED` and `ServiceError` to `REFUSED`, so `?` works on both.

## Build settings that matter

- Target `i686-pc-windows-gnu`, `crate-type = ["cdylib"]` (add `"rlib"` to
  test the same code on your machine).
- Keep `panic = "unwind"` in the profile you ship. With `abort`, a panic
  ends the game instead of being caught at the boundary.
