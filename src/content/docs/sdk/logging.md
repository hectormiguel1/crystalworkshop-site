---
title: Logging
description: Log through Crux into Crux.jsonl, with formatted lines in init and allocation-free stack lines in hook paths.
---

A unit logs through the host's `log` service. Crux writes every line to its
log, `Crux.jsonl` in the Crux folder (see [Crux logs](../../crux/logs/)
for where it is and how to turn on the console). Each line is one JSON
event from the `extension` source, with the level in front of your text
(`level=2 hello: session 1`).

## Levels

| Constant | Value | Helper |
| --- | --- | --- |
| `abi::level::ERROR` | 0 | `host.error(format_args!(...))` |
| `abi::level::WARN` | 1 | `host.warn(format_args!(...))` |
| `abi::level::INFO` | 2 | `host.info(format_args!(...))` |
| `abi::level::DEBUG` | 3 | `host.log(abi::level::DEBUG, "...")` |

```rust
let host = init.host();
host.info(format_args!("my unit {}: ready", env!("CARGO_PKG_VERSION")));
host.warn(format_args!("my unit: storage unreadable ({rc})"));
```

- `error`, `warn` and `info` format into a 512-byte line on the stack (no
  allocation) and pass it to Crux.
- `host.log(level, &str)` and `host.log_bytes(level, &[u8])` pass text as
  is. Crux logs at most 4096 bytes of one message
  (`abi::LOG_MESSAGE_MAX`).
- Without the `log` service every call is a no-op. Require
  `Service::Log` if your unit cannot run silently.

## In hook paths

Hooks run on the game's threads, often while the game's allocator is busy.
Format into a fixed stack buffer instead of a `String`:

```rust
use workshop_ext_sdk::log::{self, Line};

if let Some(host) = HOST.get() {
    let line: Line = log::line(format_args!("scene {} hp {}", scene, hp));
    host.log_bytes(abi::level::DEBUG, line.as_bytes());
}
```

`Line<N>` (default 192 bytes) truncates at a character boundary, so it is
always valid UTF-8.

## Good log lines

- Prefix every line with your unit's name and version, so players and you
  can find it among other mods.
- In `init`, log why the unit refused to start (wrong game, a site that
  did not verify, a service that failed). Players attach `Crux.jsonl` to
  bug reports.
- Do not log every frame at `INFO`. Put chatty output behind a setting or
  at `DEBUG`.
