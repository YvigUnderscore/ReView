# Licensing

> Updated: 2026-08-02

ReView is free software distributed under the **GNU Affero General Public License,
version 3 or later** (`AGPL-3.0-or-later`). The full text is in [LICENSE](../../LICENSE) at
the repository root.

Copyright © 2026 Yvig Bidon.

## Why AGPL

ReView is a self-hosted web platform. Under the plain GPL, a company could take the code,
improve it, run it as a hosted service for its clients and never publish a line back,
because nothing is *distributed*. The AGPL closes that gap: section 13 extends the
copyleft obligation to users who interact with the software **over a network**.

Selling ReView, or a service built on it, is expressly allowed — that is one of the four
freedoms. What is not allowed is keeping modifications private while offering the result
to others.

## What this means for you

### Running ReView unmodified

Nothing to do. Every network-facing surface already carries the notice and the link to its
source: the login and setup screens, the client share pages, the public API explorer at
`GET /api/docs`, and **Admin → System → License & source**. The frontend image also serves
[`/LICENSE`](/LICENSE) and [`/THIRD-PARTY-NOTICES.md`](/THIRD-PARTY-NOTICES.md) as plain
text, so the license travels with a deployment and not only with the repository.

### Running a modified ReView

You must offer the corresponding source of *your* version to everyone who uses your
instance — your employees, your clients on share links, everyone.

1. Publish your fork (a public Git repository is the customary way).
2. Set **Admin → Settings → "Code source (AGPL §13)"** to your repository URL.

That setting feeds the public `GET /api/studio/branding` endpoint and every "Source code"
link in the interface. Only `http`/`https` URLs are accepted; anything else falls back to
the upstream repository. Leaving it empty while running modified code does not satisfy
section 13.

### Distributing the Docker images

The backend image bundles third-party programs of its own:

| Program | License | Present |
|---------|---------|---------|
| FFmpeg (Debian build) | GPL-2.0-or-later | Always |
| assimp-utils | BSD-3-Clause | Always |
| fonts-dejavu-core | Bitstream Vera / permissive | Always |
| Blender | GPL-2.0-or-later | Only with `--build-arg INSTALL_USD_TOOLS=1` |
| usd-core | Apache-2.0 / modified Apache (TOST) | Only with `INSTALL_USD_TOOLS=1` |
| guc | Whatever the release you point at ships | Only with `--build-arg GUC_URL=…` |

If you republish those images, you also redistribute those programs and must pass on their
source offers. Pointing at the upstream Debian and Blender sources is sufficient — you have
not modified them.

Both images declare `org.opencontainers.image.licenses=AGPL-3.0-or-later` and their source
repository as OCI labels, so a registry or a scanner reads the license without unpacking
them. The backend image keeps its dependencies' own `LICENSE` files inside `node_modules`;
the frontend image ships the minified bundle instead, which is why `LICENSE` and
`THIRD-PARTY-NOTICES.md` are copied next to it and served as plain text.

## Third-party dependencies

[THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md) lists every production dependency
redistributed with ReView — 594 packages across backend and frontend — with the verbatim
license text each one ships. It is generated, never hand-written:

```bash
node scripts/generate-notices.mjs          # regenerate
node scripts/generate-notices.mjs --check  # fail if stale (run by validate.sh)
```

The script does more than write the file: it **fails the build** when a production
dependency declares a license outside the allow-list — proprietary, source-available (BSL,
Elastic, Commons Clause, SSPL), GPL-2.0-only, or no identifiable license at all. SPDX
expressions are evaluated properly, so `(MPL-2.0 OR Apache-2.0)` passes on either branch
while `(MIT AND SSPL-1.0)` does not. A package whose `package.json` omits the field but
whose `LICENSE` file is unambiguous goes through `LICENSE_OVERRIDES`, checked by hand.

Every dependency is AGPL-3.0 compatible. Two points worth knowing:

- **Apache-2.0** (62 packages, including the AWS SDK, Prisma and hls.js) is compatible with
  GPLv3 and AGPLv3, but **not** with GPLv2. Adopting a v2-only license would mean replacing
  them, so version 3 is not negotiable here.
- **MPL-2.0** dependencies (`web-push`, `lightningcss`) carry no "Incompatible With
  Secondary Licenses" notice, so they may be combined under the AGPL.

Services ReView talks to over the network — PostgreSQL, Redis, MinIO (AGPL-3.0), ClamAV,
Prometheus, Grafana, nginx — are separate programs in their own containers. That is mere
aggregation: their licenses do not propagate, and ReView's does not reach them.

## Source file headers

Every source file starts with an SPDX header — TypeScript and JavaScript, but also the
Prisma schema, the Python USD workers, the shell scripts and the stylesheets, each in its
own comment syntax:

```ts
// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later
```

so that a file lifted out of the repository still carries its license. The headers are
applied and verified by a script, and the validation suite fails without them:

```bash
node scripts/add-license-headers.mjs          # add missing headers
node scripts/add-license-headers.mjs --check  # verify (run by validate.sh)
```

## Contributing

Contributions require a signed CLA — see [CONTRIBUTING.md](../../CONTRIBUTING.md) and
[CLA.md](../../CLA.md). You keep the copyright on your work; the CLA grants the maintainer
the rights needed to keep offering ReView under a commercial license alongside the AGPL.

## Commercial license

Studios that cannot accept the AGPL's obligations can buy a proprietary license instead.
See [COMMERCIAL-LICENSE.md](../../COMMERCIAL-LICENSE.md).