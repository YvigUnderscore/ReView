<p align="center">
  <img src="frontend/public/logo_full.png" alt="ReView Logo" width="400">
</p>

<p align="center">
  <b>Collaborative media review platform for VFX &amp; post-production studios</b><br>
  Open-source · Self-hostable · Desktop-first
</p>

<p align="center">
  <a href="https://discord.gg/vw7h6BqcNc">
    <img src="https://img.shields.io/discord/1462953450907238614?color=5865F2&label=Discord&logo=discord&logoColor=white" alt="Discord Server" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/licence-AGPL--3.0--or--later-blue" alt="AGPL-3.0-or-later licence" />
  </a>
  <a href="#-languages">
    <img src="https://img.shields.io/badge/languages-14-22d3ee" alt="14 languages" />
  </a>
</p>

---

**ReView** is a collaborative review platform built for VFX studios, post-production teams and creatives. Frame-accurate video, annotated images, 3D & USD scenes, Gaussian splats, reference boards, kanban, live dailies, secure client shares and full studio administration — all in one place, on your own infrastructure. **One instance = one studio.**

## Overview

| Area | What ReView does |
|------|------------------|
| 🎬 **Video** | Adaptive HLS, frame-by-frame, A/B · wipe · diff · 2×2 grid, frame-anchored annotations, safe areas, contact sheet |
| 🖼️ **Image** | Overlay annotations, A/B comparison, reference, lightbox |
| 🧊 **3D & USD** | DCC-style viewer, end-to-end USD (scenegraph, variants, overrides), inspection, OCIO, F-curve camera |
| ✨ **Splats** | Spark viewer, non-destructive editor, SPZ export, SOG playback |
| 💬 **Collaboration** | Threads, mentions, voice notes, customisable statuses, dailies & live review room |
| 🔒 **Distribution** | Hardened links, burn-ins, slates, per-viewer watermark |
| 🛡️ **Identity & API** | OIDC SSO, 2FA, scoped tokens, HMAC webhooks, OpenAPI |
| 🏭 **Production** | Inherited pipeline settings, publication lock, quotas, stats, calendar, Gantt |
| ⚙️ **Infra** | Docker, FFmpeg workers (NVENC), resumable uploads + dedup, backups, Prometheus/Grafana |

## ✨ Features

### 🎬 Video review

- **Adaptive multi-rendition HLS** playback, precise **frame-by-frame** navigation, in/out looping, timeline markers, hover thumbnails (sprite generated at transcode time).
- Version comparison: synchronised side-by-side, **wipe** (orientable bar), GPU-composited **diff** |A − B| (with heatmap), **2×2 grid** for up to four versions.
- Vector annotations anchored to the delivery frame (shapes, polygon), persistent **in→out ranges** during playback, comments tied to the exact frame.
- **Letterbox** guide at delivery aspect, centre cross, **action/title safe** (90 %/80 %).
- Exportable **contact sheet** (PNG grid of the range), annotated frame export, trim, animated hover thumbnails on cards, theatre mode and detachable player (PiP).

### 🖼️ Image review

Overlay annotations, A/B comparison between versions, reference image, lightbox and fullscreen — same comments and decisions as video.

### 🧊 3D & USD review

- **DCC-style Three.js viewer**: unified orbit/fly navigation, **HDRI** lighting (studio library + per-project default HDRI + shadow-catcher ground), focal length in mm on a 36 mm sensor, PiP preview.
- **End-to-end USD**: native conversion of `.usd`/`.usdc`/`.usda`/`.usdz` and `.zip` archives via **Blender + usd-core** (falling back to `guc`, then assimp) — `UsdPreviewSurface` materials, variants and `UsdSkel` animation preserved.
- **Scenegraph**: real prim tree in the Scene panel, **click-to-select** in the viewer, selection halo, `F` frames the selection, per-prim context menu (variants, hide, isolate, reset).
- **Baked variants** in the converted file: instant switching, even on published media.
- Non-destructive **ReView overrides**: per-prim TRS via gizmo, visibility, variant choice — persisted, replayed for everyone, or attached to a comment as a navigable scene proposal.
- **Inspection**: shaded/wireframe/normals/matcap/UV modes, technical sheet (polycount, materials, UVs, conversion provenance), texture inspector, shared camera bookmarks, turntable, section plane, **3D A/B** comparison with linked cameras.
- **Reliable GLB animation**: skeletal rigs, morph targets, clip selector, skeleton debug overlay.
- **F-curve animated camera** (Hermite channels): editable dopesheet + graph editor, **Alembic** (.abc) camera import, staging persisted per media and replayed identically for every viewer.
- **OCIO** colour management (per-project display/view, ACES catalogue).

### ✨ Gaussian splats

- **Spark (SparkJS)** viewer integrated into the Three.js scene — **PLY**, **SPZ** formats and **SOG/SOGS** (PlayCanvas) playback.
- **Non-destructive** editor: brush/volume selection, masking, tint, TRS — the original file is never modified, edits are replayed identically for everyone.
- **Cleaned splat export to SPZ**, progressive loading of large files, staging (camera, DoF) persisted per media.

### 💬 Comments & approval

- **Discussion threads** with @ mentions, resolution, reactions, **voice notes**, local drafts, deep links to a frame or a comment, comment → kanban task conversion, watching by shot/asset/version.
- **Approval workflow** with **customisable** per-studio review statuses: decisions recorded per version, badges everywhere, filters.
- **Dailies**: cross-shot playlists with chained playback, and a synchronised **live review room** — a driver broadcasts playback, navigation, comparison and 3D camera to the whole room, handing over control in one click.

### 📋 Boards, kanban & documents

- **Excalidraw boards** per project and per asset (mood, references).
- Per-project **kanban**: pipeline-typed tasks, checklists, multi-select and bulk actions.
- Rich **documents** (briefs, meeting notes) at studio or project level.

### 🔒 Secure distribution

- **Hardened** client share links: password, expiry, view limit, revocation, access audit — clean client page in the studio's colours.
- **Configurable burn-ins** (shot/version/timecode/logo) baked in at transcode time, identification **slates** at the head of shares, **per-viewer name watermark**.

### 🛡️ Identity & public API

- **OIDC SSO** (Google…), **TOTP 2FA** with backup codes, per-device **revocable sessions**, media access log.
- **Personal API tokens** with read/write scopes for scripting the REST API, **HMAC-signed outgoing webhooks** (media published, decision, comment).
- Interactive API reference (**OpenAPI/Scalar**, generated from the Zod schemas) served at `/api/docs`.

### 🏭 Pipeline, organisation & reporting

- **Project → Sequence → Shot / Asset → Task → Version** hierarchy; draft before publication, **publication lock** (published content is immutable — you fix it with a new version).
- **Inherited** delivery settings, studio → project → sequence → shot (resolution, framerate, frame ranges).
- **Project templates and duplication**, restorable read-only archiving, **storage quotas**, per-project roles, naming conventions, **CSV import/export** (ShotGrid/Ftrack/Kitsu bridge).
- **Reporting**: review statistics (time per shot, notes & retakes, convergence per sequence), **deadline calendar**, **per-sequence Gantt**, weekly production report by email.

### ⚙️ Infrastructure & operations

- Complete **Docker Compose** stack: PostgreSQL, MinIO (S3, presigned URLs), Redis, backend, worker, frontend — plus optional Prometheus, Grafana and ClamAV.
- **BullMQ + FFmpeg** workers: multi-rendition HLS (optional **NVENC** with x264 fallback), thumbnails & sprites, 3D → GLB conversion, Blender/guc/assimp USD chain, splat operations.
- **Resumable uploads** in parts with integrity verification, SHA-256 **deduplication** (instant upload), optional antivirus.
- Documented **backup/restore** (database + MinIO objects), Prometheus metrics + provisioned Grafana dashboard, in-app job dashboard, trash and derived-file purge, administration audit log.

### 🎨 Personalisation & everyday UX

Light/dark/system theme · display density · **14 interface languages** · reconfigurable shortcuts (`?` cheatsheet) · Ctrl+K palette & right-click menus · favourites · saved list views · resume where you left off · **studio theme** (accent + logo on the login screen) · **Web Push** and **Slack/Discord** notifications · in-app "What's new" changelog · onboarding tour · **unified review workspace** (modes, tool rail, options bar, inspector dock) shared by all four viewers.

### 📚 Built-in documentation

The product manual ([`DOCUMENTATION/`](DOCUMENTATION/README.md), in English) is versioned with the code and served **inside the application** at `/docs`: user guides, admin guide, API reference and infrastructure.

## 🌍 Languages

English is the source language: the interface, the documentation and this README are written in English first. ReView also ships thirteen more, chosen so that a studio can work in its own language — including regional languages that rarely get software written for them.

| | Language | | Language |
|---|---|---|---|
| 🇬🇧 | English *(source)* | 🇮🇳 | हिन्दी — Hindi |
| 🇫🇷 | Français — French | 🏴 | Brezhoneg — Breton *(regional)* |
| 🇪🇸 | Español — Spanish | 🏴 | Euskara — Basque *(regional)* |
| 🇩🇪 | Deutsch — German | 🏴 | Corsu — Corsican *(regional)* |
| 🇵🇹 | Português — Portuguese | 🏴 | Elsässisch — Alsatian *(regional)* |
| 🇨🇳 | 简体中文 — Chinese (Simplified) | 🏴 | Occitan — Occitan *(regional)* |
| 🇰🇷 | 한국어 — Korean | | |
| 🇯🇵 | 日本語 — Japanese | | |

> ### ⚠️ These translations are machine-generated
>
> **Every language other than English was translated automatically, with no human proofreading.**
> Wording may be clumsy, unidiomatic, or plainly wrong. The same warning is shown in the
> application wherever a language is chosen — in a user's profile and in the studio settings.
>
> **Corrections are very welcome, and they are the only way these catalogues get better.**
> That goes double for the regional languages ReView stands up for: Breton, Basque, Corsican,
> Alsatian and Occitan have far fewer speakers reviewing software strings than English does,
> and a single native speaker reading through a catalogue makes an enormous difference.
> A correction is a one-line edit in a JSON file — no build step, no framework to learn.
>
> **Proposals for new languages are equally welcome.** Adding one is three steps: an entry in
> the language registry, a code in the `Locale` union, and a `messages/<code>.json` file.
> Untranslated keys fall back to English, so a partial catalogue is useful from its first line.

Production terminology is deliberately **left in English in every language** — `shot`, `sequence`,
`dailies`, `playblast`, `version`, `annotation`, `review`, `board`, `retake`. Artists read these
words in English in every pipeline they touch; translating them would make the tool harder to read,
not easier. The list is enforced by `scripts/check-translations.mjs`.

How to contribute a translation, and the full conventions:
[DOCUMENTATION/development/i18n.md](DOCUMENTATION/development/i18n.md).

## 🚀 Quick start

```bash
git clone https://github.com/YvigUnderscore/ReView.git
cd ReView
cp .env.example .env   # → edit JWT_SECRET, MinIO, PostgreSQL, Redis…
docker compose up -d --build
```

The application is available at **http://localhost:3429** (API on `:3430`, optional Grafana on `:3431`).
Full guides: [Installation](DOCUMENTATION/getting-started/installation.md) · [Docker stack](DOCUMENTATION/getting-started/docker-stack.md) · [Production deployment (nginx/TLS)](DEPLOYMENT.md).

### 🔑 Accounts & first launch

- **Real first launch**: with no seed, the instance starts in **setup mode** — the first screen creates the studio and the administrator account. No default password exists in production.
- **Development seed** (`npm run seed` in `backend/`):

| Account | Email | Password |
|---------|-------|----------|
| Admin | `admin@review.local` | `admin1234` |
| Artist | `artist@review.local` | `artist1234` |

> ⚠️ Local development only — never expose a seeded instance.

## 🧱 Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js + Express 5 + TypeScript + Prisma + PostgreSQL 16 |
| Frontend | React 19 + Vite 7 + Tailwind CSS + shadcn-style primitives |
| Auth / Realtime | JWT (+ OIDC SSO, TOTP 2FA) / Socket.io |
| Jobs | BullMQ + Redis (FFmpeg workers: multi-rendition HLS, thumbnails, 3D→GLB conversion, USD chain Blender + usd-core → `guc` → assimp) |
| 3D / Splat | Three.js / Spark (SparkJS) |
| Board | Excalidraw (MIT) |
| Storage | MinIO (S3-compatible), presigned URLs; nginx TLS front in production |
| Observability | Prometheus + Grafana (optional), `/metrics` endpoint |

Architecture details: [DOCUMENTATION/infrastructure/architecture.md](DOCUMENTATION/infrastructure/architecture.md).

## 📂 Repository layout

```
ReView-app/
├── docker-compose.yml       # postgres + minio + redis + backend + worker + frontend (+ monitoring)
├── DEPLOYMENT.md            # production deployment (nginx, TLS, prod overlay)
├── DOCUMENTATION/           # product/admin/API/infra docs (EN, served in-app at /docs)
├── backend/                 # Express 5 + Prisma: routes, services, workers, tests
├── frontend/                # React 19 + Vite: v2 app (pages, review, ui), stores, tests
├── monitoring/              # Prometheus/Grafana provisioning
├── nginx/                   # production reverse-proxy config
└── scripts/                 # validate.sh (typecheck + build + lint + tests), utilities
```

## 🧪 Development

```bash
bash scripts/validate.sh                    # typecheck + build + lint + unit tests
bash scripts/validate.sh --with-integration # + integration tests (docker stack required)
bash scripts/validate.sh --with-e2e         # + Playwright smoke tests
```

Conventions, code structure and the validation suite: [DOCUMENTATION/development/](DOCUMENTATION/development/code-structure.md).

## ⭐ Star History

<a href="https://www.star-history.com/#YvigUnderscore/ReView&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=YvigUnderscore/ReView&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=YvigUnderscore/ReView&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=YvigUnderscore/ReView&type=date&legend=top-left" />
 </picture>
</a>

## 🙏 Acknowledgements & licences

ReView stands on other people's work: **[React](https://react.dev/)**,
**[Vite](https://vitejs.dev/)**, **[Node.js](https://nodejs.org/)**,
**[Express](https://expressjs.com/)**, **[Prisma](https://www.prisma.io/)**,
**[TailwindCSS](https://tailwindcss.com/)**, **[Three.js](https://threejs.org/)**,
**[Spark](https://sparkjs.dev/)**, **[Excalidraw](https://excalidraw.com/)**,
**[Socket.IO](https://socket.io/)**, **[BullMQ](https://bullmq.io/)**,
**[MinIO](https://min.io/)**, **[FFmpeg](https://ffmpeg.org/)**,
**[Blender](https://www.blender.org/)**, **[OpenUSD](https://openusd.org/)** — and 594
more packages.

The exhaustive list, with each licence text, lives in
**[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)** (generated by
`node scripts/generate-notices.mjs`, never by hand).

## 📄 Licence

ReView is **free software under [AGPL-3.0-or-later](LICENSE)**.

You may install it and modify it. The only thing asked in return: if you offer a **modified
version** to others — including simply by hosting it for your clients — you must give them
its sources (section 13). In practice, publish your fork and set its URL in
**Admin → Settings → "Source code (AGPL §13)"**. An unmodified instance has nothing to do.

Your media, projects and data are never covered: the licence applies to the software.

- **[Commercial licence](COMMERCIAL-LICENSE.md)** — for studios that cannot accept the
  obligations of the AGPL.
- **[Contributing](CONTRIBUTING.md)** · **[CLA](CLA.md)** — contributions go through a licence
  agreement, which is what makes the dual licence possible.
- **[Licensing documentation](DOCUMENTATION/development/licensing.md)** — detailed obligations,
  dependency compatibility, Docker image redistribution.

> Until 2 August 2026, ReView was distributed under the MIT licence.
