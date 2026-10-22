---
title: "Walkthrough: hello-unit"
description: Build, test, package and run the SDK's example unit, which verifies a call site, counts sessions in host storage and adds a Mod Settings page.
---

`examples/hello-unit` in the SDK repository is a complete unit for FINAL
FANTASY XIII (Steam). It:

- verifies one **call site** in the game executable (another mod's entry
  detour there is accepted);
- keeps a **storage record** counting the sessions it ran in, in the mod's
  host storage (never in the game's saves);
- adds a **settings page** with a section and a checkbox to the shared Mod
  Settings menu;
- logs a greeting at start and a line at shutdown.

## 1. Get the code

```sh
git clone https://github.com/hectormiguel1/workshop-extension-sdk
cd workshop-extension-sdk
```

## 2. Read the unit

Open `examples/hello-unit/src/lib.rs`. From top to bottom:

1. **`ID`** is the stable unit, storage region and settings provider ID,
   `example.hello`.
2. **`NEEDS`** requires FINAL FANTASY XIII, the log service and a mapped
   image.
3. **`sites!`** declares `SITES`: one function entry with its first 16
   retail bytes, kind `call`.
4. **`Saved`** is the stored record:

   ```rust
   #[derive(Clone, Debug, PartialEq, workshop_ext_sdk::PackedRecord)]
   #[packed(version = 1, schema = 1)]
   pub struct Saved {
       #[packed(max = 65535)]
       pub sessions: u16,
       #[packed(default = 1)]
       pub greet: bool,
   }
   ```

5. **`settings!`** declares `menu`: a *General* section with a *Greet at
   field idle* checkbox bound to the `GREET` atomic.
6. **`start(init, read, memory)`** is the unit's logic. It takes the image
   reader and the memory policy as parameters, so tests can run it:
   - `host.require(&NEEDS)`, or return `UNUSABLE_CONTEXT`;
   - `sites::verify(SITES, ...)`, logging every problem and accepted
     detour; return `REFUSED` unless every site passed;
   - `init.storage(ID)`: read the record (`Saved::load`), add one session,
     write it back against the revision it read;
   - `init.settings()`: register `menu::query` under `menu::ID`;
   - `HOST.set(host)`, so `shutdown` can log later;
   - log `hello: session N` when the checkbox is on.
7. **`live_start`** passes the real image reader and `win::LiveMemory` on
   Windows (and stand-ins elsewhere, so the code builds everywhere).
8. **`ff13_unit! { init: live_start, shutdown: stop }`** emits the two
   exports.

## 3. Run its tests

```sh
cargo test -p hello-unit
```

The tests run `start` against `FakeHost` with a reader that serves the
expected bytes:

- the first run returns 0, logs `hello: session 1`, registers a two-row
  menu and stores `{ sessions: 1, greet: true }`;
- seeding that record back, the next run counts session 2;
- XIII-2 is refused with code 1, an unreadable site with code 2, and a
  null context with code 1.

## 4. Build the DLL

```sh
cargo build -p hello-unit --target i686-pc-windows-gnu --profile host-dll
cargo run -p workshop-ext-sdk --example export_check -- \
    target/i686-pc-windows-gnu/host-dll/hello_unit.dll
```

`host-dll` is the workspace's shipping profile (release, fat LTO, one
codegen unit, symbols stripped, panics unwind). `export_check` prints
`exports exactly init, shutdown`.

## 5. Package and run it

1. In CrystalWorkshop, open FINAL FANTASY XIII, then the **Project** page.
2. Add the DLL under the unit id `example.hello` and tick **Late (first
   field idle)**, to match the example's "Greet at field idle" setting.
3. **Export…** › **Shard (.cws)**, name it "Hello unit", version `0.1.0`.
4. Install the shard with PulseDepot (and the XIII Mod Settings mod for
   the menu), apply, start the game.

`Crux.jsonl` then shows `hello: session 1`, and `hello: session 2` the next
time you start the game. The example ships no translated texts, so in the
XIII Mod Settings menu its labels read "Unavailable" until you add them
(see [In-game settings](../settings/#texts-and-translations)).

The full step-by-step is in [Package a shard](../packaging/).

## Make it yours

- Change `ID` (and the package name) before you change anything else.
- Replace `SITES` with the addresses your unit needs, copied with their
  bytes from the executable you verified.
- Add hooks with `init.install_hooks` (see
  [Sites and hooks](../sites-and-hooks/)) and settings that follow the save
  slot with `PerSave` (see [Storage and per-save state](../per-save/)).
