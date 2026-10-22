---
title: Crux APIs and the Extension SDK
description: Write native extensions for the FINAL FANTASY XIII trilogy that Crux loads into the game, with the open-source workshop-ext-sdk for Rust.
sidebar:
  label: Overview
---

A **Crux extension** (an *extension unit*) is a small 32-bit Windows DLL
that ships inside a mod's CrystalWorkshop Shard (`.cws`). When the game
starts, Crux loads the units of every enabled mod, calls each unit's `init`
once and keeps it resident. A unit can then call or hook game functions,
add a page to the in-game Mod Settings menu, keep its own state, and follow
the player's save slot. It never writes the game's save files.

A unit exports exactly two functions and nothing else:

| Export | Called | Contract |
| --- | --- | --- |
| `init(const FF13HostContext *ctx)` | once, on Crux's loader thread | returns `0` to stay loaded; any other value unloads the unit and removes the hooks it created |
| `shutdown(void)` | when the game process ends | optional work, never fails |

The **extension SDK** (`workshop-ext-sdk`) is the Rust library for writing
units. It is open source under MIT or Apache-2.0:
[github.com/hectormiguel1/workshop-extension-sdk](https://github.com/hectormiguel1/workshop-extension-sdk).

What it gives you:

- the host ABI as `#[repr(C)]` Rust types, tested against Crux's C headers;
- `ff13_unit!`, which writes the two exports and catches panics at the
  boundary;
- `sites!` tables of byte-verified game addresses, with one shared policy
  for calling and hooking;
- all-or-nothing hook installs with rollback;
- host storage regions and bit-packed records (`#[derive(PackedRecord)]`);
- `settings!` providers for the shared Mod Settings menu;
- save events and `PerSave`, for settings and state kept per save slot;
- allocation-free log lines;
- `FakeHost`, an in-memory host for testing a unit on your own machine.

## Pages

1. [Set up a project](setup/): toolchain, target, `Cargo.toml`.
2. [Units and exports](units/): `ff13_unit!`, the init scope, return codes.
3. [Sites and hooks](sites-and-hooks/): verifying addresses, call and hook
   policy, safety.
4. [In-game settings](settings/): `settings!`, control kinds, translations.
5. [Storage and per-save state](per-save/): host storage, packed records,
   save events.
6. [Logging](logging/): what lands in `Crux.jsonl`.
7. [Package a shard](packaging/): add the DLL to a CrystalWorkshop project,
   export a `.cws`, install it with PulseDepot.
8. [Testing](testing/): host tests with `FakeHost`, export checks.
9. [Walkthrough: hello-unit](hello-unit/): the example unit end to end.
10. [API reference](reference/): the modules and where the full rustdoc is.

## Before you start

- Units are native code inside the game process: they can do anything the
  game can. CrystalWorkshop and PulseDepot both show a "contains native
  code" warning for mods that ship units.
- Units target the Steam releases. Every address a unit uses is checked
  against the retail bytes first; on any other build the unit refuses to
  start and leaves the game untouched.
- The SDK is at version 0.1.0. Pin it to a release tag.
