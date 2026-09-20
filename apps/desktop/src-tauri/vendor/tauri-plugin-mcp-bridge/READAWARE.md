# ReadAware MCP bridge source

This directory vendors the Rust plugin from
[`hypothesi/mcp-server-tauri`](https://github.com/hypothesi/mcp-server-tauri),
version 0.13.0, with the local revisions already used by ReadAware:

- `016b2d3`: run background automation without activating windows;
- `ab639e2`: use one execution deadline for webview scripts;
- `d0c6543`: decode screenshots once before encoding.

The snapshot was copied from local revision `56b206b` (whose additional changes
only concern workspace tooling). `Cargo.toml`, `build.rs`, `src`, `permissions`,
the upstream README, and the MIT license are retained without changes.

Keeping this source in the repository lets a clean checkout build on every
desktop platform without depending on a developer's filesystem or unpublished
Git commits. ReadAware still initializes the bridge only in debug builds; this
does not enable it in release builds.

When updating, compare the upstream plugin and these three revisions, preserve
the background execution behavior, and update this provenance note. JavaScript
workspace packages and their build artifacts are not needed by the Rust crate.
