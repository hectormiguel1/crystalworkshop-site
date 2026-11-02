---
title: Main-menu entries
description: Add your own entries to the main menu of FINAL FANTASY XIII, XIII-2 and LIGHTNING RETURNS, open a notice window when one is chosen, and share the menu with other mods.
---

The SDK's `menu` module adds rows to the game's main menu: the pause menu
in FINAL FANTASY XIII, the main menu in XIII-2 and LIGHTNING RETURNS. A row
has a label and a help line, and choosing it calls a function of your unit
on the game thread. From there you can open the game's notice window or
change the row's help text.

It works in the Steam builds of all three games. Choosing a mod row never
writes anything to the player's saves.

Settings do not go through this module: describe them with `settings!`
and Crux shows them under **Configuration → Mod Settings** in all three
games ([In-game settings](../settings/)).

## Add an entry

```rust
use workshop_ext_sdk::menu::{self, Entry, Selected};
use workshop_ext_sdk::prelude::*;

fn hello(selected: &Selected) {
    let _ = selected.show_message("Hello from my mod!");
}

const ENTRY: Entry<'static> = Entry {
    label: "Hello",
    help: "Says hello.",
    on_select: hello,
};

fn start(init: &Init) -> InitResult {
    let host = init.host();
    match menu::add_main_entry(host, &ENTRY) {
        Ok(id) => host.info(format_args!("my mod: menu entry {:#x}", id.value())),
        Err(why) => host.warn(format_args!("my mod: no menu entry: {why}")),
    }
    Ok(())
}

workshop_ext_sdk::ff13_unit! { init: start }
```

`add_main_entry` checks the game executable first. It refuses, and changes
nothing, when the executable is not one of the verified Steam builds (the
Microsoft Store builds are not supported) or when another mod has already
changed the same places in a way the SDK does not recognise. The row
appears the next time the player opens the menu, after the game's own
rows.

## Texts

A label or help text is either:

- a **text key** your mod ships in its container (a key starting with `$`),
  which the game looks up so it follows the player's language; or
- plain **printable ASCII**, shown as written.

| Text | Length | Notes |
| --- | --- | --- |
| label | 1 to 63 bytes | |
| help | 0 to 191 bytes | |
| notice | 1 to 255 bytes | no `\|`: the notice window splits a title and choices at it |

A key the game cannot find may show as an empty line, so check your texts
in game.

## When the player chooses the entry

Your function gets a `Selected`:

| Method | What it does |
| --- | --- |
| `id()`, `game()` | the entry and the game |
| `show_message(text)` | opens the game's notice window with `text`; the player closes it as usual |
| `set_help(text)` | replaces the entry's help line (shown again as soon as your function returns) |

The function runs inside the menu's input handling: keep it short. A panic
is caught and the menu carries on.

Outside the callback, `menu::set_help(id, text)` changes an entry's help
line, `menu::remove(id)` removes an entry (its row is gone the next time
the menu opens) and `menu::remove_all(game)` removes all of your unit's
entries, for example in `shutdown`.

## How many rows

The menu list holds 16 rows, and the game fills some of them itself, so
each game has room for a fixed number of mod entries, shared by every mod:

| Game | Game's own rows (at most) | Mod entries |
| --- | ---: | ---: |
| FINAL FANTASY XIII | 10 | 6 |
| FINAL FANTASY XIII-2 | 14 | 2 |
| LIGHTNING RETURNS | 10 | 6 |

`menu::capacity(game)` returns the number. When every row is taken,
`add_main_entry` returns `MenuError::Full`: log it and carry on without
the entry.

## Sharing the menu with other mods

Every mod DLL carries its own copy of the SDK, so the SDK coordinates them
through one shared table per game process:

- The **first** unit that adds an entry checks the executable, redirects
  the three places in the menu code the SDK uses, and records itself in
  the table as their owner.
- Every **later** unit checks the same executable and accepts those three
  places only when they hold exactly the owner's changes. It then adds its
  entry to the table; it never changes the game code again.
- The owner's code serves every unit's entries: it adds their rows, shows
  their help lines and calls the right unit's function when a row is
  chosen.
- A unit that adds an entry stays loaded for the rest of the session, so
  the menu never calls into a DLL that is gone.

Units built with different SDK versions keep working together as long as
the table format is the same. If it is not, the second one refuses with a
clear log line instead of stacking changes on the first.

## What the SDK changes in the game

Three places in each game's menu code, each compared byte for byte with the
verified executable first:

1. After the game adds its own rows, the SDK adds the mod rows with the
   game's own function (mod entries use IDs from `0x1000` up).
2. When a row is chosen, mod IDs are answered by the SDK. They never reach
   the game's own code, which would first mark the command as seen in the
   save's progress data. The game's own rows work exactly as before.
3. The help line: the game looks its help texts up by row ID without a
   bound, so the SDK serves the help line of mod rows itself. The game's
   own rows keep their help.

## Limits

- **Microsoft Store** builds are not supported: `add_main_entry` refuses
  on them.
- Whether rows beyond the game's own fit the menu's background panel has
  not been checked in every game; test your entry in game.

## Testing

`testing::FakeGame` is a fake game for your tests. While it exists it is
the game `menu::add_main_entry` talks to on that thread, and it plays the
menu the way the game would:

```rust
#[test]
fn the_entry_greets() {
    use workshop_ext_sdk::testing::{FakeGame, FakeHost};
    let game = FakeGame::new(abi::GAME_XIII);
    let host = game.host();
    assert_eq!(unsafe { workshop_ext_sdk::unit::run_init(host.context(), start) }, 0);
    game.open_menu(10);           // the game's 10 rows, then yours
    game.select(10);              // highlight your row
    game.update_help();
    game.decide();                // choose it
    let log = game.log();
    assert_eq!(log.messages, ["Hello from my mod!"]);
    assert!(log.save_writes.is_empty());
}
```

| `FakeGame` | What it does |
| --- | --- |
| `new(game)`, `host()` | a fake game and a `FakeHost` whose image matches it |
| `open_menu(rows)`, `rows()` | open the menu with that many of the game's own rows; the row IDs |
| `select(row)`, `decide()`, `update_help()` | the player highlights and chooses a row |
| `log()` | rows added, help lines, notice texts, and every command that reached the game's own decide code (`save_writes`) |
| `as_module(n)` | later calls come from another mod DLL |
| `poke(rva, bytes)`, `fail_write`, `fail_pin`, `fail_registry` | another build, another mod's change, failures |

## Walkthrough: hello-menu

`examples/hello-menu` in the SDK repository is a complete unit for all three
games. It adds one entry, "Hello"; choosing it opens a notice window with a
greeting and changes the entry's help line to count how often it was
chosen this session. In LIGHTNING RETURNS it also registers a `settings!`
provider for that game with one setting, "Hello notice", that turns the
notice window off or on; the choice is kept in its host storage region.

Build and test it from a clone of the repository:

```sh
cargo test -p hello-menu
cargo build -p hello-menu --target i686-pc-windows-gnu --profile host-dll
cargo run -p workshop-ext-sdk --example export_check -- \
    target/i686-pc-windows-gnu/host-dll/hello_menu.dll
```

Package `hello_menu.dll` like any unit ([Package a shard](../packaging/)).
In game, open the main menu: "Hello" is the last row. The log
(`Crux.jsonl`) shows `hello-menu: entry 0x1000 added` (and, in LIGHTNING
RETURNS, `hello-menu: notice setting registered`), or the reason it
refused.

The example ships no texts for its setting. Crux's Mod Settings menu
hides a setting whose texts the mod does not ship, so "Hello notice"
appears under **Configuration → Mod Settings** only after you add its
texts to the mod ([Texts and translations](../settings/#texts-and-translations)).
