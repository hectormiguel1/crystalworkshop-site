---
title: Package a shard
description: Add your unit DLL to a CrystalWorkshop project, export a CrystalWorkshop Shard (.cws) and install it with PulseDepot.
---

Players never copy DLLs by hand. A unit travels inside a **CrystalWorkshop
Shard** (`.cws`), next to any data, text and scripts your mod changes.
PulseDepot installs the shard; Crux loads the unit when the game starts.

The flow: **project → native code unit (and attachments) → export →
install with PulseDepot**.

## 1. Build the release DLL

```sh
cargo build --release --target i686-pc-windows-gnu
```

Check its exports first (see [Testing](../testing/)): exactly `init` and
`shutdown`.

## 2. Add it to your project

1. Open CrystalWorkshop with the game your unit targets (see
   [First run](../../crystalworkshop/first-run/)).
2. Open the **Project** page (`Ctrl+K` › *Project*).
3. Under **Native code**, type a **unit id**: 1 to 64 printable characters,
   no spaces, unique in your mod. Keep it the same in every release.
4. Tick **Late (first field idle)** if your unit should start at the first
   field idle instead of while the mod image loads (see
   [Units and exports](../units/#when-crux-calls-them)).
5. Choose **Add DLL…** and pick your DLL. The row shows the unit's phase,
   size, SHA-256 and exports, and other installed mods that ship a unit with
   the same id. Adding a DLL under an existing id replaces it.

The page shows a red "contains native code" notice: a unit runs inside the
game and can do anything the game can. PulseDepot shows players the same
warning.

## 3. Add attachments (optional)

Under **Attachments**, add a README or other files players should get with
the mod. The changelog and artwork come from the mod metadata.

If your unit has a menu, add its translated texts to the mod as well (see
[In-game settings](../settings/#texts-and-translations)).

## 4. Export the shard

1. Choose **Export…** in the navigator. A project with extension units can
   be exported even without file changes.
2. Choose **Shard (.cws)**.
3. Fill in the **Mod metadata**: name, description and a semver version
   are required; add the changes for this version.
4. Choose **Build shard**. CrystalWorkshop builds the shard, verifies it
   and writes it to the **Output** path shown in the metadata form.

The full export options are in the
[Mod export reference](../../crystalworkshop/mod-export/).

## 5. Install and test with PulseDepot

1. Start PulseDepot, pick the game, choose **Add mod…** and select the
   `.cws`.
2. If your menu needs it, also install the
   [XIII Mod Settings](../../mods/mod-settings/) mod.
3. Review and apply, then start the game (see
   [Install shard mods](../../pulsedepot/install-shards/)).
4. Read `Crux.jsonl` for your unit's lines (see [Logging](../logging/)).

Removing the mod in PulseDepot removes the unit. The game's saves are
never touched.

## Automating it

The same steps are available to scripts and AI clients through
CrystalWorkshop's MCP server: the `project` tool's `add_unit` operation
(`id`, `path` to the DLL, `late`) and `add_attachment`, then the shard
export. See [AI clients (MCP)](../../crystalworkshop/mcp/).
