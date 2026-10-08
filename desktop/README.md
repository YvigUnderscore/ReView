<!--
SPDX-FileCopyrightText: 2026 Yvig Bidon
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# ReView Desktop

ReView Desktop is the native application of ReView, built on Tauri 2. Version 0.2 (alpha)
connects to an existing ReView server and opens it in a private window: the viewer is the
server's own, and nothing from the server is written to disk. Local projects and
peer-to-peer projects are announced on its first screen and come in later updates.

- User guide: [`DOCUMENTATION/getting-started/desktop-app.md`](../DOCUMENTATION/getting-started/desktop-app.md)
- Development, release and code signing: [`DOCUMENTATION/development/desktop-app.md`](../DOCUMENTATION/development/desktop-app.md)
- Changes: [`CHANGELOG.md`](CHANGELOG.md)

## Quick start

Requires Node 22, Rust stable and the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm ci
npm run dev        # launcher in a window, with hot rebuild of the Rust side
npm test           # launcher tests (vitest + happy-dom)
npm run build      # release binary and installers in src-tauri/target/release/bundle/
```

Rust checks: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test`
in `src-tauri/`, or `bash scripts/validate.sh --with-desktop` from the repository root.

## Webview measurements

The launcher's `Diagnostic` link runs `launcher/probe/index.html`, which measures what the
viewer depends on (WebGL 2, float textures, MSE codecs, WebAssembly SIMD) and draws 4,000
instances for two seconds. Compare its report with the same page opened in Chrome on the same
machine. The throughput follows `requestAnimationFrame`, so it caps at the display's refresh
rate: it separates software rendering from a real GPU, not two good engines from each other.

| OS | Machine | Webview | Reference (same machine) | Verdict |
| --- | --- | --- | --- | --- |
| Windows 11 | RTX 5080, D3D11, 144 Hz | WebView2 154 — 144 fps | Chrome 154 — 143 fps | viable |
| macOS | — | to measure (CI build green) | — | — |
| Linux | — | to measure (CI build green) | — | — |

Windows (2026-10-08): 28 of 31 probes return the same value on both sides; the other three
are the context, the engine name and the throughput. The only reservation,
`SharedArrayBuffer`, is missing on both sides for lack of COOP/COEP headers. The real viewer
ran in the window — video playback, frame-accurate seeking, a USD scene, a Gaussian splat and
a freehand annotation.

If WebKitGTK falls short on Linux, the fallbacks are, in order: a better GPU path
(`WEBKIT_DISABLE_DMABUF_RENDERER`, proprietary drivers), Electron for Linux only, or Linux
staying on the browser.
