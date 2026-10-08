# Desktop app development

*How `desktop/` is built, tested, released and signed: the Tauri shell, the launcher, the security model and the release workflow.*

> Updated: 2026-10-08

`desktop/` is ReView Desktop: a Tauri 2 application whose window shows either its own
launcher or a ReView server. It lives in the monorepo on `dev`, next to the server it
connects to, and is released on its own tags (`desktop-vX.Y.Z`). The user side is described
in [Desktop app](../getting-started/desktop-app.md).

## Layout

| Path | What it holds |
|------|---------------|
| `desktop/src-tauri/src/main.rs` | Commands exposed to the launcher, app state, window events |
| `desktop/src-tauri/src/server_url.rs` | Turns what a user types into a server origin, or a coded error |
| `desktop/src-tauri/src/probe.rs` | Checks that an origin is a ReView server (`/api/version`, `/api/studio/branding`) |
| `desktop/src-tauri/src/store.rs` | `servers.json`, the only file server mode writes |
| `desktop/src-tauri/src/windows.rs` | Private server windows, launcher hide/show, new-window policy |
| `desktop/src-tauri/capabilities/` | Which window may call which command |
| `desktop/launcher/` | The launcher: plain ES modules and CSS, no build step |
| `desktop/launcher/i18n/` | The fourteen catalogs of the launcher (`en.json` defines the keys) |
| `desktop/launcher/probe/` | The webview diagnostic page |
| `desktop/launcher/legal/THIRD-PARTY-NOTICES.txt` | Generated notices of everything the binary ships |
| `desktop/assets/`, `desktop/scripts/make_brand_assets.py` | Vector logo, icon source, installer artwork and their generator |

The app is a **local ReView client, not a second frontend**. A server window loads the
server's own origin, so the web frontend's relative URLs (`/api`, `/socket.io`) reach the
right backend with no configuration and no CORS. Nothing in `frontend/` knows the desktop app
exists.

## Build and test

Prerequisites: Node 22, Rust stable, and the
[Tauri system dependencies](https://tauri.app/start/prerequisites/) (WebView2 is part of
Windows; Linux needs WebKitGTK 4.1 and OpenSSL headers).

```bash
cd desktop && npm ci
```

```bash
npm run dev
```

```bash
npm run build
```

`npm run build` writes the binary to `src-tauri/target/release/` and the installers to
`src-tauri/target/release/bundle/`. For quick iterations, `npx tauri build --debug
--no-bundle` builds in seconds instead of minutes (no link-time optimisation) and embeds the
launcher the same way.

| Check | Command | Where it runs |
|-------|---------|---------------|
| Launcher format and tests (vitest + happy-dom) | `npm run format:check && npm test` | `validate.sh`, Desktop workflow |
| Rust format, clippy without warnings, unit tests | `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` | `validate.sh --with-desktop`, Desktop workflow |
| Notices up to date | `node scripts/generate-desktop-notices.mjs --check` | `validate.sh --with-desktop`, Desktop workflow |

The launcher tests run against the real catalogs: every catalog must carry every key, keep
the English placeholders, leave the production glossary untranslated, and the language list
must match the web application's registry (`frontend/src/v2/i18n/locales.json`).

To read the webview from a script — the diagnostic report, a page's console — start the app
with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` on Windows and talk
to it over the Chrome DevTools protocol. `--lang=ja` in the same variable forces a language.

## Security model

- **Commands are declared and granted per window.** `build.rs` lists every command; each
  becomes an `allow-<command>` permission. The `launcher` capability grants them to the
  launcher window only, the `diagnostic` capability grants `host_info` to the diagnostic
  window. A server window is in no capability: a page from a server cannot call any command —
  verified by calling them from a server page, which answers *not allowed on window*.
- **Server windows are private** (`incognito`): cookies, storage and cache stay in memory.
- **Autofill is off in every window** (`generalAutofillEnabled: false` and
  `general_autofill_enabled(false)`): WebView2 otherwise stores typed values on disk, even
  with `autocomplete="off"`.
- **New-window requests are filtered**: same origin stays in the app, `http(s)` and `mailto`
  go to the default browser, any other scheme is refused (`windows::new_window_policy`).
- **The launcher has a strict CSP** (`default-src 'self'`); Tauri adds hashes for the inline
  script of the diagnostic page.
- **Links out are named, not passed**: `open_link` takes `source`, `server_install` or
  `desktop_guide` and builds the URL itself. Documentation links point at the
  `desktop-vX.Y.Z` tag of the running version.
- **Commands that create a window are `async`**: on Windows, building a window from a
  synchronous command deadlocks the event loop.

## Third-party notices

The binary statically links about 440 crates, plus the Inter font of the launcher.
`scripts/generate-desktop-notices.mjs` walks the normal dependency graph from
`cargo metadata` (all platforms, no dev dependencies), checks every license against the same
allow-list as the npm notices (`ALLOWED_LICENSES` in `scripts/generate-notices.mjs`), and
writes each license text once. The file starts with a UTF-8 byte order mark: Tauri serves
`.txt` without a charset, and WebView2 would otherwise decode it as Windows-1252.

```bash
node scripts/generate-desktop-notices.mjs
```

Run it after any change to `Cargo.lock`. The installers ship it as `THIRD-PARTY-NOTICES.txt`
next to `LICENSE.txt`, and the launcher shows it from its footer.

## Release

A release is a tag. The Desktop workflow (`.github/workflows/desktop.yml`) builds Windows,
macOS (universal) and Linux, attests each installer's build provenance, computes
`SHA256SUMS.txt` and creates a GitHub pre-release with the notes of `desktop/CHANGELOG.md`.

1. Set the version in `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml`
   and `desktop/package.json`, and add a `## [X.Y.Z]` section to `desktop/CHANGELOG.md`.
2. Commit on `dev` after `bash scripts/validate.sh --with-desktop`.
3. Tag and push:

```bash
git tag -a desktop-v0.2.0 -m "ReView Desktop 0.2.0" && git push origin desktop-v0.2.0
```

The release job refuses a tag that does not match `tauri.conf.json` or has no changelog
section. Builds pushed without a tag still produce installers as workflow artifacts for 30
days, which is how a change is tried on a real machine before it is released.

## Code signing

Signing proves who published an installer; without it, Windows SmartScreen and macOS
Gatekeeper warn on first launch. What the workflow does today, and what each platform needs:

| Platform | Today | To remove the warning |
|----------|-------|-----------------------|
| All | SHA-256 sums and Sigstore build provenance on every release | — |
| macOS | Ad hoc signature (`signingIdentity: "-"`), required to run on Apple Silicon | Apple Developer Program membership, a *Developer ID Application* certificate, notarisation |
| Windows | Unsigned | An Authenticode certificate, or a cloud signing service |
| Linux | Unsigned (usual for AppImage and `.deb`) | Optional: a GPG signature of `SHA256SUMS.txt` |

**macOS.** The workflow signs and notarises as soon as these repository secrets exist; Tauri
reads them directly:

| Secret | Value |
|--------|-------|
| `APPLE_CERTIFICATE` | The *Developer ID Application* certificate exported as `.p12`, base64-encoded |
| `APPLE_CERTIFICATE_PASSWORD` | The password chosen at export |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Account e-mail, an app-specific password, the team ID — used for notarisation |

**Windows.** Certificates issued since June 2023 keep their private key on hardware or in a
cloud HSM, so there is no `.pfx` to store as a secret. Two routes fit the workflow:

- **A cloud signing service** whose command-line tool signs one file — set the secret
  `WINDOWS_SIGN_COMMAND` to that command with `%1` for the file, and add a step installing
  the tool. The workflow passes it to Tauri as `bundle.windows.signCommand`, which signs the
  executable and the installers.
- **Signing on a workstation** that holds the certificate (a USB token, or a provider's
  virtual card): build there with the certificate's thumbprint.

```bash
npx tauri build --config '{"bundle":{"windows":{"certificateThumbprint":"<thumbprint>","digestAlgorithm":"sha256","timestampUrl":"http://time.certum.pl"}}}'
```

> [!NOTE]
> SmartScreen reputation builds per certificate and per file over downloads: even a signed
> installer can be flagged at first. Extended validation no longer grants immediate
> reputation.
