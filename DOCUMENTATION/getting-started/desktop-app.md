# Desktop app

*ReView Desktop 0.2 (alpha): install it, connect to a ReView server in a private window, and know exactly what stays on your disk.*

> Updated: 2026-10-08

ReView Desktop opens your studio's ReView server in a native window. The viewer is the
same one you use in a browser — video, image, 3D, USD and Gaussian splat review with
annotations — because the window loads the server itself, not a copy of it.

Version 0.2 is an **alpha**. It delivers one of the three ways of working the app is
designed around: connecting to an existing ReView server. Creating a project on your own
machine and joining someone else's project without a server are announced on the first
screen and arrive in later updates.

## Install

Download the installer for your system from the
[ReView Desktop releases](https://github.com/YvigUnderscore/ReView/releases) (tags
`desktop-v…`).

| System | File | Notes |
|--------|------|-------|
| Windows 10 / 11 | `ReView_0.2.0_x64-setup.exe` (or the `.msi`) | Uses the WebView2 runtime that ships with Windows |
| macOS 12 or later | `ReView_0.2.0_universal.dmg` | One build for Apple Silicon and Intel Macs |
| Linux | `ReView_0.2.0_amd64.AppImage`, `.deb` or `.rpm` | Needs WebKitGTK 4.1 (Ubuntu 22.04 and later) |

The alpha builds are **not code-signed** with a commercial certificate yet, so your system
warns you the first time:

- **Windows** — SmartScreen shows *Windows protected your PC*. Choose `More info`, then
  `Run anyway`.
- **macOS** — the app is signed ad hoc, not notarised. Open it once, then go to
  `System Settings → Privacy & Security` and choose `Open Anyway` next to ReView.
- **Linux** — make the AppImage executable (`chmod +x`) and run it, or install the `.deb`.

> [!IMPORTANT]
> Only run an installer whose fingerprint matches the release. The next chapter shows how to
> check it in one command.

## Verify your download

Every release publishes `SHA256SUMS.txt` next to the installers, and every installer carries
a build provenance attestation signed through GitHub's OIDC identity (Sigstore). Either check
proves the file is the one the release workflow built from the public repository.

```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
```

```bash
gh attestation verify ReView_0.2.0_x64-setup.exe --repo YvigUnderscore/ReView
```

On Windows without `sha256sum`, `Get-FileHash ReView_0.2.0_x64-setup.exe` in PowerShell prints
the same hash.

## First launch: choose how you work

The first screen asks one question — *How do you want to work?* — with three cards. Each
card answers the same three questions in the same order: what lands on this disk, what is
shared, and what happens when you close the app.

| Card | On this disk | Shared | If you close | In 0.2 |
|------|--------------|--------|--------------|--------|
| Create a project here | projects and media | directly, end-to-end encrypted | unavailable if you're the only one | coming in a later update |
| Join a project | what you download | with the project's members | another computer takes over | coming in a later update |
| ReView server | **nothing** | according to the server's rules | nothing changes | available |

No card is pre-selected. Click `ReView server`, or move to it with `Tab` and press `Enter`.

The app speaks the same fourteen languages as the web application and follows your system
language; a language it does not offer falls back to English.

## Connect to a ReView server

Type the server address — `review.my-studio.com` is enough, `https://` is added for you —
and press `Connect`. The app checks that a ReView server answers there before it opens or
saves anything. When it does, the server opens in its own window and the launcher steps
aside; it comes back when you close the last server window, with your servers listed.

| Message | What to do |
|---------|------------|
| *Server unreachable* | Check the address, your network, or the studio VPN |
| *Secure connection failed* | The server's certificate is not trusted by this computer, or the server has no HTTPS: try its `http://` address on the studio network |
| *A server answers at this address, but it is not a ReView server* | The address points at another web service |
| *http:// address: the connection is not encrypted* | A warning, not an error: keep plain `http://` to the studio's local network |

The window title always states the mode — for example
`Studio Durian (review.studio.fr) — ReView server · nothing on this disk` — so a server
window is never mistaken for anything else.

Links that open a new window stay in the app when they point at the same server. Links to
any other site open in your default browser, outside the private window.

## What stays on this disk

In server mode the app behaves like a private browser window:

- **The server window is private.** Cookies, local storage and the media cache live in
  memory and are gone when the window closes. The flip side: you sign in each time you open
  a server.
- **The only thing written is the server list** — address, studio name, server version and
  dates, in `servers.json` in the app's configuration folder. An address is saved only after
  the server answered as a ReView server; a mistyped or refused address leaves no trace.
- **Form autofill is off** in every window, so what you type is not remembered by the
  embedded browser engine.

| System | Configuration folder |
|--------|----------------------|
| Windows | `%APPDATA%\io.github.yvigunderscore.review` |
| macOS | `~/Library/Application Support/io.github.yvigunderscore.review` |
| Linux | `~/.config/io.github.yvigunderscore.review` |

To forget a server, choose `Remove`, then `Confirm removal`, on its row.

> [!NOTE]
> A file you download from the server (an export, a media file) is saved where you choose,
> like in any browser. That is your action, not the app's.

## Footer: diagnostic, licenses, source

The launcher's footer carries four links:

- `Diagnostic` runs the webview diagnostic — WebGL 2, float textures, codecs, WebAssembly and
  a two-second rendering benchmark — and shows a verdict with a JSON report to copy into an
  issue. It tells you whether this machine's embedded browser can run the viewer.
- `Third-party licenses` lists the components the app is built from and their licenses. The
  same file is installed next to the app as `THIRD-PARTY-NOTICES.txt`, with `LICENSE.txt`.
- `Guide` opens this page for your installed version.
- `Source code (AGPL-3.0)` opens the repository. ReView is free software under the GNU
  Affero General Public License v3.0 or later.

## Known limits of the alpha

- Local projects and peer-to-peer projects are not available yet.
- A server window does not keep you signed in between sessions (see above).
- A server with a self-signed certificate is refused unless this computer trusts it; install
  the studio's certificate authority in the system store.
- The installers are not signed with a commercial certificate (see [Install](#install)).
