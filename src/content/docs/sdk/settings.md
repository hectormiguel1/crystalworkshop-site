---
title: In-game settings
description: Add a page to the shared Mod Settings menu with settings!, choose control kinds, bind lock-free Param values and ship translated texts.
---

Units do not draw their own menus. They describe their settings to Crux as
a *settings provider*, and Crux shows every provider in one shared
**Mod Settings** menu, at the end of the game's **Configuration** list in
FINAL FANTASY XIII, XIII-2 and LIGHTNING RETURNS. The menu comes with Crux:
players need nothing besides your mod ([Mod Settings menu](../../mods/mod-settings/)).

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
        game: workshop_ext_sdk::abi::GAME_XIII,   // exactly one game
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
use workshop_ext_sdk::log::Tag;
const TAG: Tag = Tag::new("hello", env!("CARGO_PKG_VERSION"));

let shown = init.register_settings(TAG, menu::ID, menu::query);
```

`register_settings` returns `false`, and logs a warning after your tag,
when the host has no settings service or refuses the provider; your unit
keeps running without its page. To handle the refusal yourself, use
`init.settings()?` and `Settings::register`, which returns the host's
status (`STATE_CONFLICT` when another module already owns the ID).

The page appears after `init` succeeds.

### One game per provider

`game` names exactly one game: `abi::GAME_XIII`, `abi::GAME_XIII_2` or
`abi::GAME_LR`. `game: 0` does not compile. The menu shows only the
running game's providers and hides a provider that answers every game, so
a unit built for several games declares one provider per game and
registers the one for `init.host().game()`.

## What players see

- **Configuration → Mod Settings** (shown when at least one mod has valid
  settings for the running game) lists every mod with settings for the
  running game, then the mod's groups (`section`s), then the settings of
  the group the player picks. A mod with a single group skips the group
  page: its settings are listed directly.
- Long lists are split into pages with **Previous page** and **Next
  page** rows. A page holds up to 12 mods or groups, or a heading and 11
  settings, in XIII and XIII-2, and up to 15 rows in LIGHTNING RETURNS
  (13 mods or groups, or a heading and 12 settings), so it never scrolls.
- **Left/Right** changes a value, **Confirm** opens a page, toggles a
  checkbox or presses a button, and **Back** returns step by step to the
  game's own list.
- Anything Crux cannot show is hidden rather than shown broken: a control
  that is malformed, whose value cannot be shown or whose texts your mod
  does not ship; a provider whose name has no text or that has no control
  left. Crux names each hidden entry, with the reason, in `Crux.jsonl`.
- The menu calls your callbacks and keeps nothing itself. It never
  writes the game's configuration or saves.

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

The menu shows no literal strings. It looks every string of a provider up
in the game's text (ZTR) resources, under a key derived from the English
text, in the language the game runs in. A string without an entry is
never shown: the control that needs it is hidden (and named in the log).
So a unit with a menu ships its own texts in its mod, in every text
language of its game. The menu's own texts (its title, the page and value
rows, its notices) are built into Crux in every language; you only ship
your provider's texts.

The `texts` module helps:

- `texts::key("Gil")` is the key of a string: `$ms` and 12 hex digits
  (the low 48 bits of its FNV-1a 64 hash).
- `texts::LOCALES` lists the eleven languages in catalog order:
  `us uk fr gr it sp jp ru ch ck kr`. LIGHTNING RETURNS has only eight
  (`texts::LR_LOCALES`; it shows us texts for uk, ru and ck), and
  `texts::locales(game)` returns a game's list.
- `unsafe { texts::required(menu::descriptor(), &runtime_strings) }` lists
  every string the adapter will look up (provider name, section and
  control labels and help, combo options, display prefixes and suffixes),
  plus the strings your unit looks up itself at run time.
- `texts::problems(&required, CATALOG)` checks your catalog: missing
  strings, empty translations, and `{0}`-style placeholders that differ
  from the English source. `texts::problems_for` checks only one game's
  locales.
- `texts::missing_in(&required, rows)` checks the text of a built mod: one
  `key<TAB>locale<TAB>text` row per line, the shape of a CrystalWorkshop
  `SELECT key, locale, text FROM texts` query. `texts::missing_for`
  checks only one game's locales.
- `texts::json_lines(&required, CATALOG)` writes the catalog as JSON lines
  for your own build tools.
- `texts::cli(locales, &required, CATALOG)` is a whole texts tool in one
  call, for a small example binary: `my_unit_strings --json` prints the
  texts to add, and `my_unit_strings DUMP.tsv` checks a built mod's text
  dump and fails when anything is missing.

### The game's language at run time

Texts your unit shows itself (a notice, a help line) can follow the
game's language too. `Host::text_locale()` returns the running text
language as a `host::Locale`: `code()` (`"us"`, `"jp"`, ...), `column()`
(its column in `texts::LOCALES`) and `text(&entry)` (an entry's text in
that language). It already folds the languages the game shows as English
(uk and ru; in XIII-2 and LIGHTNING RETURNS also ck). It is `None` until
the game has chosen its language, which happens after every unit's
`init`, and with an older Crux, so ask when you need a text, not in
`init`.

Add the entries to your mod's text with CrystalWorkshop's text editor (see
[Text (ZTR)](../../crystalworkshop/ztr-text-edit/)), then export the shard
with the DLL and the texts together.
