---
title: Storage and per-save state
description: Keep a unit's state in Crux host storage, pack it with PackedRecord, and follow the player's save slot with save events. Mods never write the game's saves.
---

## The rule: mods never write saves

A unit never reads or writes the game's save files. Everything it keeps
goes into **Crux host storage**: one `mod-state.dat` file per installed
mod, split into regions by a stable ID. Installing or removing a mod
therefore never changes a save. When a unit needs state that follows the
player's save slot, it keys that state by the slot that Crux's **save
events** report.

## Host storage regions

Register a region in `init`. The ID is 1 to 64 ASCII letters, digits, `.`,
`_` or `-`, and must stay the same across releases:

```rust
if let Some(region) = init.storage("example.hello").map_err(|_| InitError::REFUSED)? {
    match region.read_all() {
        Ok(Some((info, bytes))) => { /* info.schema, info.revision, bytes */ }
        Ok(None) => { /* never written */ }
        Err(status) => { /* log it and run with defaults */ }
    }
}
```

`Ok(None)` from `init.storage` means this Crux has no storage service:
run with defaults for the session.

`Region` methods:

| Method | Does |
| --- | --- |
| `info()` | schema, length and revision, or `Ok(None)` if never written |
| `read(offset, &mut buf)`, `read_all()` | read bytes |
| `write(expected_revision, schema, &bytes)` | replace the whole region |
| `write_ranges(expected_revision, length, schema, &ranges)` | one atomic batch of ranges |
| `flush()` | ask Crux to flush to disk |

Writes are checked against the revision you read (0 for a new region), and
each successful write is atomic and durable. After `STATE_IO_ERROR` the
outcome is unknown: do not retry with stale state; reopen next session.
Hold on to the `Region` handle (it is thread-safe) to write later.

## Packed records

Keep stored bytes small and versioned with `#[derive(PackedRecord)]`:

```rust
use workshop_ext_sdk::packed::PackedRecord as _;   // the trait's methods

#[derive(Clone, Debug, PartialEq, workshop_ext_sdk::PackedRecord)]
#[packed(version = 1, schema = 1)]
pub struct Saved {
    #[packed(max = 65535)]
    pub sessions: u16,          // key "Sessions", 16 bits
    #[packed(default = 1)]
    pub greet: bool,            // key "Greet", 1 bit
}

let bytes = Saved::defaults().encode().unwrap();
let back = Saved::load(1, &bytes);      // schema 1: decode
```

The format: byte 0 is the format version; the numeric fields follow
LSB-first in declaration order, each storing `value - min` in
`ceil(log2(max - min + 1))` bits; an optional text tail of
`(section, key, value)` entries follows (`#[packed(text)] text: Vec<TextEntry>`).

- Container attributes: `version` (format byte, default 1), `schema` (the
  host storage schema, default 1), `migrate = path`
  (`fn(u32, &[u8]) -> Option<Self>`), `valid = path` (`fn(&Self) -> bool`).
- Field attributes: `key` (default: the field name in PascalCase),
  `default` (default: `min`), `min` (default 0), `max` (required except for
  `bool`), `text`.
- **Never reorder or resize released fields.** Add fields under a new
  `schema` and convert old bytes in `migrate`; `load(schema, bytes)` calls
  it for any schema other than the current one.

## Save events

Crux tells a unit when the game saves, loads or starts a new game:

| Event | Meaning | What to do |
| --- | --- | --- |
| `SaveBegin` | a save starts | snapshot your state |
| `Saved` | the save completed | persist that snapshot |
| `SaveFailed` | the save failed | drop the snapshot |
| `Loaded` | a save was loaded | restore that slot's state |
| `NewGame` | a new game started (no slot) | reset transient state |

```rust
use workshop_ext_sdk::abi::SaveEvent;
use workshop_ext_sdk::save_events::{EventKind, mask_of};

fn on_save(event: &SaveEvent) -> i32 {
    match event.event_kind() {
        Some(EventKind::Loaded) => { let _slot = event.valid_slot(); 0 }
        _ => 0,
    }
}

// in init:
if let Some(events) = init.save_events()? {
    let slots = events.info().map(|i| i.slot_count).unwrap_or(0);
    events
        .register("example.hello", mask_of(&EventKind::ALL), on_save)
        .map_err(|_| InitError::REFUSED)?;
}
```

- Handlers run synchronously on the game's save or load thread: keep them
  short and never start another save or load.
- The return value is advisory: nonzero is logged, it never blocks the
  game's save or load. A panic is caught and reported as
  `save_events::HANDLER_PANICKED`.
- Only trust `event.valid_slot()` and `event.valid_profile()`. A missing
  slot is never slot 0.
- `register` fails with `UNAVAILABLE` when Crux has no save adapter for
  the running executable.

## Settings that follow the save slot: `PerSave`

`per_save::PerSave` does all of the above for you. It keeps one region,
`<unit-id>.per_save`, with a fixed record per profile and slot, and
handles the event sequence:

| Moment | What happens |
| --- | --- |
| process start | defaults; everything off |
| menu edits | memory only |
| `SaveBegin` | the state is captured per save operation (at most 64 pending) |
| `Saved` | that capture is written (revision-checked) and flushed |
| `SaveFailed` | the capture is discarded |
| `Loaded` | queued writes finish, then the slot's record is restored; no record: defaults, off |
| `NewGame` | memory is kept (title-screen choices carry over) |
| an event without a valid slot | logged; a load restores defaults, off |

`per_save::Params` adapts a set of `Param`s, one of them the per-slot
*Enabled* flag:

```rust
use workshop_ext_sdk::param::Param;
use workshop_ext_sdk::per_save::{Params, PerSave};

static ENABLED: Param = Param::flag("Enabled", false);
static LEVEL: Param = Param::new("Level", 3, 1, 9);
static PARAMS: Params = Params::new(1, &ENABLED, &[&LEVEL]);
static STORE: PerSave = PerSave::new("example.unit", &PARAMS);

fn on_save(event: &SaveEvent) -> i32 {
    STORE.on_event(event)
}

fn per_save(init: &Init) -> Result<(), InitError> {
    let id = STORE.region_id().ok_or(InitError::REFUSED)?;   // "example.unit.per_save"
    let region = init.storage(&id).map_err(|_| InitError::REFUSED)?;
    let mut slots = FALLBACK_SLOTS;   // your game's save slot count
    if let Some(events) = init.save_events()? {
        if let Ok(info) = events.info() && info.slot_count > 0 {
            slots = info.slot_count;
        }
        events
            .register(&id, mask_of(&EventKind::ALL), on_save)
            .map_err(|_| InitError::REFUSED)?;
    }
    STORE.open(region, slots);   // Opened::Fresh, Stored(n), NoService, Foreign(why) or Failed(status)
    Ok(())
}
```

`open` needs a slot count from 1 to 1000 (`per_save::MAX_SLOTS`); take
it from the save events when they report one. Without a storage region
(`None`) the settings last for the session only.

Bind the same `Param`s to the menu with `param_checkbox` and friends (see
[In-game settings](../settings/)). For other state, implement
`per_save::Adapter` (version, payload size, layout hash, `capture`,
`restore`, `new_game`). `STORE.set_log(sink)` routes the store's log
lines; `STORE.set_deferred(true)` moves the writes to a thread running
`STORE.run_writer()`. A region written with another layout is never read
or written (`Mode::Foreign`).
