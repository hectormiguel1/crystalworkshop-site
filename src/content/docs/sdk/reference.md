---
title: API reference
description: The modules of workshop-ext-sdk at a glance, and how to open the full rustdoc reference.
---

The complete reference is the SDK's rustdoc. Generate it from a clone of
the repository:

```sh
cargo doc -p workshop-ext-sdk --no-deps --open
```

or, in your own project, `cargo doc --open` (it documents your
dependencies too).

## Modules

| Module | What it gives a unit |
| --- | --- |
| `abi` | `#[repr(C)]` mirrors of Crux's C headers (`ff13_host.h`, `ff13_settings.h`, `ff13_save_events.h`): the host context, status codes, log levels, games, phases, settings and save-event types. The SDK's tests compare every struct and constant with the headers. |
| `host` | `Host` (a validated copy of the context), `Requirements` and `Service`, `Unusable`, `HostSlot`, logging, merged-container reads (`file_size`, `read_file`), `ServiceError`. |
| `unit` | `ff13_unit!`, the `Init` scope, `InitError`, `InitResult`, the return `code`s, `run_init` and `run_shutdown`. |
| `sites` | `sites!`, `Site`, `SiteKind` (`call`, `hook`, `anchor`), `verify` and `check`, `Verdict`, `Problem`, `Finding`, `Summary`, the `Memory` trait and `NoForeignCode`. |
| `hooks` | `HookSpec`, `install` (all or nothing, with rollback), `HookFailure`, `HookFactory` (init only) and `HookControl` (enable, disable, remove). |
| `image` | `Image`: the main executable's base and size, RVA bounds, `address`, and (on Windows) bounded `read` and `write`. |
| `storage` | `Region` (host storage in the mod's `mod-state.dat`): `info`, `read`, `read_all`, `write`, `write_ranges`, `flush`; `valid_id`. |
| `packed` | The packed record format: `Field`, `Layout`, `encode`, `decode`, `TextEntry`, the `PackedRecord` trait and `#[derive(PackedRecord)]`. |
| `settings` | `settings!`, `Builder`, `Meta`, `Settings` (registration), `menu_strings`. |
| `param` | `Param`: a lock-free whole-number setting with a range and a change callback. |
| `save_events` | `EventKind`, `mask_of`, `Handler`, `SaveEvents` (`info`, `register`). |
| `per_save` | `PerSave`, `Params`, the `Adapter` trait, `Opened`, `Mode`, and the region layout. |
| `texts` | ZTR keys (`key`), `LOCALES`, `required`, `problems`, `missing_in`, `json_lines`. |
| `log` | `Line`, `line`: allocation-free stack lines. |
| `pe` | `exports`, `is_unit`: export-table checks for built DLLs. |
| `testing` | `FakeHost`, `FakeMemory`, `save_event`, `event`, `pe_image`: an in-memory host for tests. |
| `win` | Windows only: `LiveMemory`, `write_code`, `pin_module`. |

`workshop_ext_sdk::prelude::*` brings in the common types: `abi`, `level`,
`Host`, `HostSlot`, `Requirements`, `Service`, `Unusable`, `Image`,
`PackedRecord`, `TextEntry`, `Param`, `Params`, `PerSave`, `Site`,
`SiteKind`, `Init`, `InitError` and `InitResult`.

## The host contract

Crux's C headers are the contract; the SDK mirrors them and its tests fail
when the mirror drifts. Copies of the headers are in the SDK repository
under `crates/workshop-ext-sdk/include/`. Fields are only ever appended: a
unit checks the context's `version` and uses its `size` to tell which
trailing fields exist, which `Host` does for you.

## Versions

The SDK follows semantic versioning from 0.1.0. Depend on a release tag:

```toml
workshop-ext-sdk = { git = "https://github.com/hectormiguel1/workshop-extension-sdk", tag = "v0.1.0" }
```

Changes are listed in the repository's `CHANGELOG.md`.
