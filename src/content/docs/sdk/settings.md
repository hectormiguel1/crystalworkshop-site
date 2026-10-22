---
title: In-game settings
description: Add a page to the shared Mod Settings menu with settings!, choose control kinds, bind lock-free Param values and ship translated texts.
---

Units do not draw their own menus. They describe their settings to Crux as
a *settings provider*, and a menu adapter shows every provider in one
shared **Mod Settings** menu. In FINAL FANTASY XIII that menu is added by
the [XIII Mod Settings](../../mods/mod-settings/) mod (Configuration →
Mod Settings), which players install alongside your mod.

## Declare a provider

```rust
use core::sync::atomic::{AtomicBool, Ordering};
static LOUD: AtomicBool = AtomicBool::new(false);

workshop_ext_sdk::settings! {
    /// The unit's Mod Settings page.
    pub mod menu {
        id: "example.hello",            // stable provider ID
        name: "Hello",
        author: "Example",
        release: env!("CARGO_PKG_VERSION"),
        help: "A minimal unit.",
        // website: "https://example.org",   (optional)
        game: workshop_ext_sdk::abi::GAME_XIII,   // 0 = any game
        controls: |b| b
            .section("general", "General", "")
            .checkbox("loud", "Loud logging", "Log every frame.",
                || LOUD.load(Ordering::Relaxed),
                |on| LOUD.store(on, Ordering::Relaxed)),
    }
}
```

The macro creates a module with `ID`, `descriptor()` (built once, kept for
the process) and the `query` callback. Register it in `init`:

```rust
if let Some(settings) = init.settings()? {
    settings
        .register(menu::ID, menu::query)
        .map_err(|_| InitError::REFUSED)?;
}
```

The page appears after `init` succeeds. Registration fails with
`STATE_CONFLICT` when another module already owns the ID.

## Control kinds

Each control has a stable ID (independent of its label and position), a
label and a help text. `Builder` methods:

| Method | Control |
| --- | --- |
| `section(id, label, help)` | starts a new group or page |
| `checkbox(id, label, help, read, write)` | on/off (`bool`) |
| `integer(id, label, help, (min, max, step), read, write)` | integer slider; writes are rounded and clamped |
| `float(id, label, help, (min, max, step), read, write)` | float value; writes are clamped |
| `combo(id, label, help, &options, read, write)` | one of a list (index `0..options.len()`) |
| `button(id, label, help, on_press)` | runs an action |
| `status(id, label, text)` | a read-only text row, refreshed every 250 ms (adapters may ignore it) |
| `value(kind, id, label, help, (min, max, step), read, write)` | any numeric kind with raw `f32` callbacks |

Modifiers apply to the last control:

- `.state(|| flags)`: visible, enabled or busy
  (`abi::SETTING_VISIBLE | SETTING_ENABLED | SETTING_BUSY`);
- `.presentation(flags)`: `abi::SETTING_ADVANCED`,
  `SETTING_RESTART_REQUIRED`, `SETTING_EXPERIMENTAL`;
- `.display(prefix, suffix, decimals)`: for numeric controls (suffix up to
  24 bytes, 0 to 6 decimals).

A malformed list (more than 256 controls, a duplicate ID, an invalid
range, a NUL in a string) panics while building. That is a bug in the unit
your tests will find: build `menu::descriptor()` in a test.

Callbacks run on the menu's thread, outside Crux's locks, and every one is
guarded against panics. Keep them quick.

## Lock-free values with `Param`

Hook paths should not lock. A `Param` is a `static` whole-number setting
(an atomic with its key, default and inclusive range) that both the menu
and your hooks use:

```rust
use workshop_ext_sdk::param::Param;

static ENABLED: Param = Param::flag("Enabled", false);
static LEVEL: Param = Param::new("Level", 3, 1, 9).with_on_change(level_changed);

fn level_changed() { /* runs after every change */ }

// in the controls:
//   .param_checkbox("enabled", "Enabled", "Turn the unit on.", &ENABLED)
//   .param_integer("level", "Level", "How strong.", 1, &LEVEL)
//   .param_combo("mode", "Mode", "", &["Off", "Low", "High"], &MODE)  // MODE: 0..=2
```

`Param::set` clamps, stores and, when the value changed, runs the change
callback. Nothing is written to disk: where a value persists is your
choice (see [Storage and per-save state](../per-save/)).

## Texts and translations

The XIII menu adapter shows no literal strings. It looks every string of a
provider up in the game's text (ZTR) resources, under a key derived from
the English text, in the language the game runs in. A missing entry shows
as "Unavailable". So a unit with a menu ships its own texts in its mod, in
all eleven game languages.

The `texts` module helps:

- `texts::key("Gil")` is the key of a string: `$ms` and 12 hex digits
  (the low 48 bits of its FNV-1a 64 hash).
- `texts::LOCALES` lists the eleven languages in catalog order:
  `us uk fr gr it sp jp ru ch ck kr`.
- `unsafe { texts::required(menu::descriptor(), &runtime_strings) }` lists
  every string the adapter will look up (provider name, section and
  control labels and help, combo options, display prefixes and suffixes),
  plus the strings your unit looks up itself at run time.
- `texts::problems(&required, CATALOG)` checks your catalog: missing
  strings, empty translations, and `{0}`-style placeholders that differ
  from the English source.
- `texts::missing_in(&required, rows)` checks the text of a built mod: one
  `key<TAB>locale<TAB>text` row per line, the shape of a CrystalWorkshop
  `SELECT key, locale, text FROM texts` query.
- `texts::json_lines(&required, CATALOG)` writes the catalog as JSON lines
  for your own build tools.

Add the entries to your mod's text with CrystalWorkshop's text editor (see
[Text (ZTR)](../../crystalworkshop/ztr-text-edit/)), then export the shard
with the DLL and the texts together.
