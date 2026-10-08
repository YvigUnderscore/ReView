<!--
SPDX-FileCopyrightText: 2026 Yvig Bidon
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Changelog — ReView Desktop

Releases are tagged `desktop-vX.Y.Z`. The release workflow publishes the section of the
tagged version as the notes of the GitHub pre-release.

## [0.2.0] — 2026-10-08

First alpha. ReView Desktop connects to an existing ReView server.

### Added

- First-launch screen with the three ways of working — create a project here, join a
  project, ReView server — each stating what lands on this disk, what is shared and what
  happens when you close. Server mode is available; the two others are announced for a later
  update.
- Server mode: the app checks that a ReView server answers at the address (`/api/version`),
  then opens it in a private window. Cookies, storage and cache stay in memory; the window
  title states the mode. Works with any ReView server already deployed — no server change.
- Saved servers, reopened in one click, removed with a confirmation. The server list is the
  only file the app writes.
- Clear errors: unreachable server, timeout, certificate or missing HTTPS, a web server that
  is not ReView, HTTP errors.
- The fourteen languages of the web application, following the system language.
- The ReView logo as application icon, and in the Windows installers.
- Webview diagnostic, third-party licenses and source code links in the launcher.
- Installers for Windows (`.exe`, `.msi`), macOS (universal `.dmg`) and Linux (`.AppImage`,
  `.deb`, `.rpm`), with SHA-256 sums and build provenance attestations.

### Security

- Commands are granted to the launcher and diagnostic windows only; a server page cannot call
  any of them.
- Form autofill is disabled in every window, so typed values are not stored by WebView2.
- Links that open a new window leave the app unless they point at the same server; other
  schemes are refused.

### Known limits

- Installers are not signed with a commercial certificate: SmartScreen and Gatekeeper warn on
  first launch.
- A server window does not keep you signed in between sessions.

## [0.1.0] — 2026-10-07

Webview spike: a window showing the diagnostic page, to measure whether each operating
system's webview can run the ReView viewer.
