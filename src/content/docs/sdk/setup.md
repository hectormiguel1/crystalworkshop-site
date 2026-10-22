---
title: Set up a project
description: Install the Rust toolchain and the 32-bit Windows target, create a library project and depend on the extension SDK by git tag.
---

The game is a 32-bit Windows program, so a unit is built for the
`i686-pc-windows-gnu` target. You can build on Windows or cross-compile on
Linux.

## 1. Install the toolchain

Install Rust with [rustup](https://rustup.rs), then add the target:

```sh
rustup target add i686-pc-windows-gnu
```

The target needs a MinGW-w64 linker for 32-bit Windows:

- **Linux:** install your distribution's i686 MinGW-w64 cross compiler
  (the package that provides `i686-w64-mingw32-gcc`, for example
  `gcc-mingw-w64-i686` on Debian and Ubuntu or `mingw-w64-gcc` on Arch).
- **Windows:** the simplest setup is the 32-bit GNU toolchain, which
  brings its own linker:
  `rustup toolchain install stable-i686-pc-windows-gnu`, then build with
  `cargo +stable-i686-pc-windows-gnu build`.

The SDK uses Rust edition 2024 and needs Rust 1.89 or newer.

## 2. Create the project

```sh
cargo new --lib my-unit
cd my-unit
```

## 3. Edit `Cargo.toml`

```toml
[package]
name = "my-unit"
version = "0.1.0"
edition = "2024"

[lib]
# cdylib: the DLL Crux loads. rlib: lets your tests link the same code.
crate-type = ["cdylib", "rlib"]

[dependencies]
workshop-ext-sdk = { git = "https://github.com/hectormiguel1/workshop-extension-sdk", tag = "v0.1.0" }

[profile.release]
# Keep the default unwinding: init, shutdown and every SDK callback catch
# panics at the boundary. With panic = "abort" a panic ends the game.
panic = "unwind"
```

The SDK has no runtime dependency besides its own derive macros. The
`derive` feature (on by default) provides `#[derive(PackedRecord)]`.

## 4. Write the smallest unit

`src/lib.rs`:

```rust
use workshop_ext_sdk::prelude::*;

const NEEDS: Requirements = Requirements {
    game: Some(abi::GAME_XIII),
    services: &[Service::Log],
    image: true,
};

fn start(init: &Init) -> InitResult {
    let host = init.host();
    host.require(&NEEDS).map_err(|why| {
        host.error(format_args!("my unit: {why}"));
        InitError::UNUSABLE_CONTEXT
    })?;
    host.info(format_args!("my unit: running on game {}", host.game()));
    Ok(())
}

workshop_ext_sdk::ff13_unit! { init: start }
```

## 5. Build the DLL

```sh
cargo build --release --target i686-pc-windows-gnu
```

The DLL is `target/i686-pc-windows-gnu/release/my_unit.dll`. Check that it
exports exactly `init` and `shutdown` (see [Testing](../testing/)), then
[package it into a shard](../packaging/).

## Next

[Units and exports](../units/) explains what `ff13_unit!` generates and
what `init` may do.
