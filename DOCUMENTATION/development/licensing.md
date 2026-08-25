# Licensing

*What the AGPL asks when you run, modify or redistribute ReView — and what the tooling actually enforces.*

> Updated: 2026-08-23

ReView is free software distributed under the **GNU Affero General Public License, version 3
or later** (`AGPL-3.0-or-later`). The full text is in [LICENSE](../../LICENSE) at the
repository root.

Copyright © 2026 Yvig Bidon.

This page is the practical version: what you owe depending on what you do with ReView, what
travels inside a deployment and under which terms, and which of those obligations a script
watches for you. Where nothing watches, it says so — a hand-written header that nothing checks
is worth knowing about.

## Why AGPL

ReView is a self-hosted web platform. Under the plain GPL, a company could take the code,
improve it, run it as a hosted service for its clients and never publish a line back, because
nothing is *distributed*. The AGPL closes that gap: section 13 extends the copyleft obligation
to users who interact with the software **over a network**.

Selling ReView, or a service built on it, is expressly allowed — that is one of the four
freedoms. What is not allowed is keeping modifications private while offering the result to
others.

## What this means for you

![Running ReView unmodified asks nothing: eight public surfaces already carry the licence notice and a link to the source. Running a modified build asks three things — publish the fork, set the source URL in Admin Settings, and let the branding endpoint carry it.](../assets/development/agpl-decision-path.svg)

### Running ReView unmodified

Nothing to do. Every network-facing surface already carries the notice and the link to its
source:

| Surface | Who reaches it | What carries the notice |
|---|---|---|
| Login and first-run setup screens | Anyone, before authentication | `SourceNotice`, fed by `GET /api/studio/branding` |
| Client share pages | A client with a link, never a studio account | `SourceNotice`, same feed |
| `GET /api/docs` | Anyone — the public API explorer | Rendered server-side from `getSourceUrl()` |
| `GET /api/version` | Anyone | `{ version, commit, builtAt, node, source }` |
| The unsubscribe page | An email recipient, unauthenticated | Rendered server-side |
| `POST /api/shotgrid/webhook` | The remote ShotGrid site | `X-Source-Code` response header |
| **Admin → System → Licence & source code** | Administrators | The published source URL, as a link |
| `/LICENSE` and `/THIRD-PARTY-NOTICES.md` | Anyone | Served as plain text by the frontend image |

The last one matters more than it looks: the licence then travels with a *deployment*, not
only with the repository. The frontend image copies both files next to the bundle and nginx
serves them at the root.

> [!NOTE]
> `/metrics` is served by the backend and is only *optionally* protected — set
> `METRICS_TOKEN` and it demands `?token=` or a bearer, leave it empty and it answers
> anybody who can reach it. It exposes no licence surface and is not a section 13 concern,
> but it is not meant to face the internet either: the shipped nginx configuration does not
> expose it, and an operator who publishes it should set the token. See
> [Monitoring](../infrastructure/monitoring.md).

### Running a modified ReView

You must offer the corresponding source of *your* version to everyone who uses your instance
— your employees, your clients on share links, everyone.

1. Publish your fork (a public Git repository is the customary way).
2. Set **Admin → Settings → "Source code (AGPL §13)"** to your repository URL.

That setting is `studio_source_url`. It feeds the public `GET /api/studio/branding` endpoint
and, through it, every "Source code" link in the interface, plus `GET /api/version` and the
server-rendered pages listed above. You wire one field; the eight surfaces follow.

> [!WARNING]
> The value is normalised before it is put in an `href`: only `http` and `https` URLs are
> accepted, and **anything else silently falls back to the upstream repository** — which
> looks like it worked and does not satisfy section 13. Leaving the field empty while running
> modified code does not satisfy it either. Check the link on the login page after you set it.

Version and commit are published on purpose. Section 13 asks for the *corresponding* source,
and only the version-plus-commit pair lets a user tell which sources match the instance they
are actually using. That is also why `docker-compose.release.yml` refuses an implicit
`latest` tag.

## What travels with a deployment

![Three layers are redistributed together: ReView's own code under the AGPL, 605 npm production dependencies inside the images, and the operating-system programs baked into the backend image. The database, cache, object store and proxy run in separate containers and keep their own licences.](../assets/development/redistribution-layers.svg)

### The Docker images

Three images are built and published: `review-backend`, `review-worker` (the same code, plus
the USD toolchain) and `review-frontend`. Both declare
`org.opencontainers.image.licenses=AGPL-3.0-or-later` and their source repository as OCI
labels, so a registry or a scanner reads the licence without unpacking them.

The backend image bundles third-party programs of its own, installed from Debian:

| Program | Licence | Present |
|---------|---------|---------|
| FFmpeg (Debian build) | GPL-2.0-or-later | Always — transcoding, thumbnails, burn-ins |
| assimp-utils | BSD-3-Clause | Always — 3D conversion to GLB |
| fonts-dejavu-core | Bitstream Vera / permissive | Always — without a font, `drawtext` fails |
| openssl | Apache-2.0 | Always — required by Prisma |
| ca-certificates | MPL-2.0 (Mozilla CA bundle) | Always |
| dos2unix | BSD-2-Clause | Always — normalises the entrypoint script |
| Blender | GPL-2.0-or-later | Only with `--build-arg INSTALL_USD_TOOLS=1` |
| usd-core | Apache-2.0 / modified Apache (TOST) | Only with `INSTALL_USD_TOOLS=1` |
| guc | Whatever the release you point at ships | Only with `--build-arg GUC_URL=…` |

If you republish those images, you also redistribute those programs and must pass on their
source offers. Pointing at the upstream Debian and Blender sources is sufficient — you have
not modified them.

The backend image keeps its dependencies' own `LICENSE` files inside `node_modules`; the
frontend image ships the minified bundle instead, which is why `LICENSE` and
`THIRD-PARTY-NOTICES.md` are copied next to it and served as plain text.

### Running prebuilt images rather than building them

Publishing and consuming prebuilt images is a supported path, not an exotic one:
`docker-compose.release.yml` swaps every `build:` for an `image:` reference, and
[`scripts/install.sh`](../getting-started/installation.md) writes the matching
`COMPOSE_FILE`, `REVIEW_IMAGE_PREFIX` and `REVIEW_IMAGE_TAG` into `.env`.
[`scripts/update.sh --version vX.Y.Z`](../getting-started/updating.md) moves between tags and
back.

That makes "distributing the Docker images" everybody's business rather than a maintainer's
footnote. A studio that publishes its own modified images to its own registry is
redistributing ReView: the section 13 obligations above apply, and so do the source offers of
the Debian programs baked in.

### The separate containers

Services ReView talks to over the network — PostgreSQL, Redis, MinIO (itself AGPL-3.0),
nginx, ClamAV, Prometheus, Grafana — are separate programs in their own containers. That is
mere aggregation: their licences do not propagate to ReView, and ReView's does not reach them.

## Third-party dependencies

[THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md) lists every production dependency
redistributed with ReView — **605 packages**, 257 in the Node runtime and 348 in the browser
bundle — with the verbatim licence text each one ships. It is generated, never hand-written:

```bash
node scripts/generate-notices.mjs          # regenerate
node scripts/generate-notices.mjs --check  # fail if stale (run by validate.sh)
```

| Licence | Packages |
|---------|----------|
| MIT | 463 |
| Apache-2.0 | 62 |
| ISC | 60 |
| BSD-3-Clause | 10 |
| 0BSD | 2 |
| BSD-2-Clause, CC0-1.0, MIT-0, MPL-2.0, OFL-1.1, Unlicense, `(MIT AND Zlib)`, `(MPL-2.0 OR Apache-2.0)` | 1 each |

The script does more than write the file: it **fails the build** when a production dependency
declares a licence outside `ALLOWED_LICENSES` — proprietary, source-available (BSL, Elastic,
Commons Clause, SSPL), GPL-2.0-only, or no identifiable licence at all. The allow-list is
explicit and short: `0BSD`, `AGPL-3.0-or-later`, `Apache-2.0`, `Artistic-2.0`,
`BlueOak-1.0.0`, `BSD-2-Clause`, `BSD-3-Clause`, `CC0-1.0`, `CC-BY-4.0`, `GPL-2.0-or-later`,
`GPL-3.0-or-later`, `ISC`, `LGPL-2.1-or-later`, `LGPL-3.0-or-later`, `MIT`, `MIT-0`,
`MPL-2.0`, `OFL-1.1`, `Python-2.0`, `Unlicense`, `WTFPL`, `Zlib`.

SPDX expressions are evaluated properly rather than string-matched: `OR` offers a choice, so
one acceptable branch is enough (`(MPL-2.0 OR Apache-2.0)` passes); `AND` imposes both, so all
branches must pass (`(MIT AND SSPL-1.0)` does not); a `WITH` exception only lifts obligations,
so the licence it qualifies is what gets examined. A package whose `package.json` omits the
field but whose `LICENSE` file is unambiguous goes through `LICENSE_OVERRIDES`, checked by
hand.

Every dependency is AGPL-3.0 compatible. Two points worth knowing:

- **Apache-2.0** (62 packages, including the AWS SDK, Prisma and hls.js) is compatible with
  GPLv3 and AGPLv3, but **not** with GPLv2. Adopting a v2-only licence would mean replacing
  them, so version 3 is not negotiable here.
- **MPL-2.0** dependencies (`web-push`, `lightningcss`) carry no "Incompatible With Secondary
  Licenses" notice, so they may be combined under the AGPL.

> [!TIP]
> Adding a dependency is two commands, in this order: install it, then run
> `node scripts/generate-notices.mjs`. The suite fails on a stale notices file as loudly as on
> a forbidden licence, so you will find out either way — better before the commit.

## Source file headers

Every source file starts with an SPDX header, so that a file lifted out of the repository
still carries its licence:

```ts
// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later
```

The comment syntax follows the extension: `//` for `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`,
`.cjs` and `.prisma`; `#` for `.sh` and `.py`; a one-line block comment for `.css`. Adding a
file type means teaching the script the extension, never writing the header by hand.

```bash
node scripts/add-license-headers.mjs          # add missing headers, idempotent
node scripts/add-license-headers.mjs --check  # verify (run by validate.sh)
```

### What the check actually scans

The script walks seven roots plus nine named configuration files. Everything else in the
repository carries its headers by convention, and nothing would notice a missing one — worth
knowing before you add a file outside the scan.

| Path | Picked up | Enforced by `validate.sh` |
|---|---|---|
| `backend/src`, `backend/scripts`, `backend/prisma` | `.ts`, `.prisma` | Yes |
| `frontend/src`, `frontend/scripts`, `frontend/e2e` | `.ts`, `.tsx`, `.js`, `.css` | Yes |
| `scripts/` | `.mjs`, `.sh` | Yes |
| Nine root configs (vitest, eslint, playwright, postcss, tailwind, vite) | `.ts`, `.js` | Yes |
| `clients/python`, `clients/dcc` | `.py` — headers present, written by hand | **No** |
| `.github/workflows` | `.yml` — headers present, written by hand | **No** |
| `monitoring/` | `.yml` — no headers | **No** |
| `node_modules`, `dist`, `build`, `coverage`, `generated`, `prisma/migrations` | — | Never scanned, by design |

## The clients you hand to workstations

`clients/` is distributed beyond the server: a standard-library-only Python package
(`review-client`, `AGPL-3.0-or-later` in its `pyproject.toml`) plus Blender and Nuke add-ons
that farm nodes and artist workstations import directly. See
[Python client](../api/python-client.md).

That is ordinary distribution, and the ordinary rules apply. A studio that modifies the client
and keeps it inside the studio owes nothing — running modified free software privately has
never been restricted, and the client is a program you *run*, not a network service other
people interact with. Hand that modified client to another company, or publish it, and you
must ship its source under the AGPL too.

The client only ever speaks `/api/v1` with a service token; it does not link against ReView's
server code, and nothing about installing it changes the obligations of the instance it talks
to.

## Contributing

Contributions require a signed CLA — see [CONTRIBUTING.md](../../CONTRIBUTING.md) and
[CLA.md](../../CLA.md). You keep the copyright on your work; the CLA grants the maintainer the
rights needed to keep offering ReView under a commercial licence alongside the AGPL. Without
it, a single external contribution would permanently block that model.

New files get their header from the script, and new dependencies must survive the allow-list:
both are part of `bash scripts/validate.sh`, so a contribution that forgets either one fails
before review. See [Validation and tests](validation-and-tests.md).

## Commercial licence

Studios that cannot accept the AGPL's obligations can buy a proprietary licence instead. See
[COMMERCIAL-LICENSE.md](../../COMMERCIAL-LICENSE.md).

## Related pages

- [Validation and tests](validation-and-tests.md) — where the header and notices checks run
- [Internationalisation](i18n.md) — the other thing every new file has to satisfy
- [Installation](../getting-started/installation.md) — the installer and prebuilt images
- [Updating](../getting-started/updating.md) — moving an instance between published tags
