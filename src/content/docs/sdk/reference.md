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
| `host` | `Host` (a validated copy of the context), `Requirements` and `Service`, `Unusable`, `HostSlot`, logging, merged-container reads (`file_size`, `read_file`), `ServiceError`; `Host::text_locale` and `Locale` (`code`, `column`, `text`): the game's running text language. |
| `unit` | `ff13_unit!`, the `Init` scope (`Init::register_settings` registers a `settings!` provider or logs why not), `InitError`, `InitResult`, the return `code`s, `run_init` and `run_shutdown`; `lifecycle!` declares a unit's host slot, its `log` function and, with a `PerSave` store, its `on_save` save-event handler. |
| `sites` | `sites!`, `Site`, `SiteKind` (`call`, `hook`, `anchor`), `verify` and `check`, `verify_logged` (logs each problem after the unit's tag), `passes` (checks silently, to pick one of several builds), `Verdict`, `Problem`, `Finding`, `Summary`, the `Memory` trait and `NoForeignCode`. |
| `hooks` | `HookSpec`, `install` (all or nothing, with rollback), `HookFailure`, `HookFactory` (init only) and `HookControl` (enable, disable, remove). |
| `image` | `Image`: the main executable's base and size, RVA bounds, `address`, and (on Windows) bounded `read` and `write`; the `Code` trait (reads and writes by RVA) and `Ledger`: groups of patches written all or nothing (`write_group`) and put back at shutdown while they still hold the unit's bytes (`restore_all`). |
| `storage` | `Region` (host storage in the mod's `mod-state.dat`): `info`, `read`, `read_all`, `write`, `write_ranges`, `flush`; `valid_id`. |
| `packed` | The packed record format: `Field`, `Layout`, `encode`, `decode`, `TextEntry`, the `PackedRecord` trait and `#[derive(PackedRecord)]`. |
| `settings` | `settings!` (one game per provider), `Builder`, `Meta`, `Settings` (registration), `single_game`, `menu_strings`. |
| `param` | `Param`: a lock-free whole-number setting with a range and a change callback. |
| `save_events` | `EventKind`, `mask_of`, `Handler`, `SaveEvents` (`info`, `register`). |
| `per_save` | `PerSave`, `Params`, the `Adapter` trait, `Opened`, `Mode`, and the region layout; `PerSave::open_in` with `Opening`: registers the region and the save-event handler in one `init` step and logs what is missing. |
| `texts` | ZTR keys (`key`), `LOCALES`, `LR_LOCALES` and `locales(game)`, `required`, `problems` and `problems_for`, `missing_in` and `missing_for`, `json_lines`, `cli` and `run_cli` (a unit's whole texts tool). |
| `menu` | `add_main_entry`, `Entry`, `Selected` (`show_message`, `set_help`), `MenuId`, `set_help`, `remove`, `remove_all`, `capacity`; `MenuError`, `TextError`; `menu::profiles` (the verified builds) and `menu::registry` (the table every unit in the process shares). Settings are `settings!` providers, not menu rows. |
| `log` | `Line`, `line`: allocation-free stack lines; `Tag`, a unit's `name version` log prefix; `LogSink`. |
| `pe` | `exports`, `is_unit`: export-table checks for built DLLs. |
| `testing` | `FakeHost`, `FakeMemory`, `save_event`, `event`, `pe_image`: an in-memory host for tests; `FakeImage`: a sparse image for `Code`; `FakeGame` and `FakeGameLog`: a fake game for main-menu entries. |
| `win` | Windows only: `LiveMemory`, `LiveCode` (the live image as `Code`), `write_code`, `pin_module`, `module_base`, `process_id`, `map_shared`. |

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
workshop-ext-sdk = { git = "https://github.com/hectormiguel1/workshop-extension-sdk", tag = "v0.4.0" }
```

Changes are listed in the repository's `CHANGELOG.md`.
