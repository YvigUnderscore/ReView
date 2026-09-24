# ReView 2.0 backend — Node 22 (glibc) for binary compatibility (ffmpeg, prisma) + AWS SDK v3
#
# TWO STAGES, like frontend/Dockerfile. The runtime image ships neither the TypeScript sources
# nor the devDependencies (typescript, vitest, eslint, tsx, supertest...), and does not run as
# root. The worker runs ffmpeg, assimp and Blender on user-uploaded files: code execution
# gained through that surface must not come with uid 0, a compiler, a TypeScript runner and
# the Prisma CLI (i.e. direct database access).

# ── Stage 1: build ────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS build

WORKDIR /app

# openssl: `prisma generate` uses it to pick the query engine for the platform.
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# package.json + schema before the install: the postinstall hook (prisma generate) needs the
# schema, and the install layer stays cached as long as neither changes.
COPY package*.json ./
COPY prisma ./prisma
# `npm ci`, not `npm install`: the build must reproduce the lockfile tree EXACTLY, otherwise
# two images built on different dates do not run the same code.
RUN npm ci

COPY . .

# Compiles TypeScript -> dist/ (and prisma/seed.ts -> dist/seed.js, see `build:seed`).
RUN npm run build

# ── Stage 2: runtime ──────────────────────────────────────────────────────────────────────
FROM node:22-slim

# The image also ships third-party programs under their own licences: FFmpeg always, and
# Blender and usd-core with INSTALL_USD_TOOLS=1, both GPL-2.0-or-later. Whoever redistributes
# this image must pass on their source offer. See DOCUMENTATION/development/licensing.md.
LABEL org.opencontainers.image.title="ReView (backend)" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.source="https://github.com/YvigUnderscore/ReView"

WORKDIR /app

# System dependencies: openssl (Prisma), ffmpeg (transcoding/thumbnails),
# assimp-utils (3D conversion FBX/OBJ/USD -> GLB), dos2unix (start.sh),
# fonts-dejavu-core (drawtext for burn-ins/slates: without a font, drawtext fails)
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ffmpeg assimp-utils dos2unix ca-certificates fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

# Native USD->glTF converter (guc), which preserves UsdPreviewSurface materials and variants.
# OPTIONAL, opt-in: pass the URL of a self-contained guc release (Linux x86_64) with
# `--build-arg GUC_URL=...`. Without a URL (default) the image is unchanged and the worker
# falls back to assimp (experimental USD support). Once installed, enable it with
# `USD_GLTF_CONVERTER=guc` on the worker service (docker-compose). See
# DOCUMENTATION/admin-guide/3d-usd.md.
ARG GUC_URL=
RUN if [ -n "$GUC_URL" ]; then \
      apt-get update -y \
      && apt-get install -y --no-install-recommends curl \
      && curl -fsSL "$GUC_URL" -o /tmp/guc.tar.gz \
      && mkdir -p /opt/guc \
      && tar -xzf /tmp/guc.tar.gz -C /opt/guc \
      && ln -sf "$(find /opt/guc -type f -name guc | head -n1)" /usr/local/bin/guc \
      && rm -f /tmp/guc.tar.gz \
      && rm -rf /var/lib/apt/lists/*; \
    fi

# Worker USD tooling, **opt-in**: `--build-arg INSTALL_USD_TOOLS=1`.
#  - headless Blender: USD->GLB conversion with full OpenUSD (composition of references,
#    payloads and variants, UsdPreviewSurface materials, animated UsdSkel, cameras).
#  - `usd-core` venv: OpenUSD Python runtime for analysis (root layer of an archive,
#    variants/purposes, unresolved assets); Blender does not expose the `pxr` module.
# Only the compose `worker` service passes this argument: the API image stays unchanged.
# Measured cost when enabled: image 1.6 GB -> 3.6 GB (Blender 1.1 GB, usd-core venv 234 MB,
# plus the X/GL libraries Blender links against). Without it, USD falls back to guc/assimp
# (and fails if neither can read the file).
# See DOCUMENTATION/admin-guide/3d-usd.md.
ARG INSTALL_USD_TOOLS=
ARG BLENDER_VERSION=4.5.9
ARG BLENDER_SHA256=dcdc3eca6c9825bb35a8033b689c053f3cb5a9b0cd2a61b2eac2a49436b4ad3d
ARG USD_CORE_VERSION=26.8
RUN if [ -n "$INSTALL_USD_TOOLS" ]; then \
      apt-get update -y \
      && apt-get install -y --no-install-recommends \
           curl xz-utils python3 python3-venv \
           libgl1 libegl1 libx11-6 libxext6 libxi6 libxxf86vm1 libxfixes3 libxrender1 \
           libsm6 libice6 libxkbcommon0 libglib2.0-0 libgomp1 \
      && curl -fsSL "https://download.blender.org/release/Blender${BLENDER_VERSION%.*}/blender-${BLENDER_VERSION}-linux-x64.tar.xz" \
           -o /tmp/blender.tar.xz \
      && echo "${BLENDER_SHA256}  /tmp/blender.tar.xz" | sha256sum -c - \
      && mkdir -p /opt/blender \
      && tar -xJf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 \
      && rm -f /tmp/blender.tar.xz \
      && rm -rf /opt/blender/*/datafiles/locale /opt/blender/*/datafiles/studiolights \
      && python3 -m venv /opt/usdenv \
      && /opt/usdenv/bin/pip install --no-cache-dir "usd-core==${USD_CORE_VERSION}" \
      && /opt/blender/blender --version \
      && /opt/usdenv/bin/python3 -c "import pxr; print('usd-core ready')" \
      && rm -rf /var/lib/apt/lists/*; \
    fi

# RUNTIME dependencies only. `prisma` is a dependency (not a devDependency): start.sh runs
# the CLI on every start for `migrate deploy`, so it cannot be pruned. The postinstall hook
# generates the Prisma client here, once and for all; the container never has to do it again
# (nor could it: node_modules belongs to root).
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Worker Python scripts (USD conversion and analysis, OCIO LUT baking). They are resolved at
# runtime under `src/workers/...` (ModelConvertService.ts, ocio/bakeRunner.ts): they are
# resources, not TypeScript, and tsc does not copy them into dist/.
COPY src/workers/usd/*.py ./src/workers/usd/
COPY src/workers/ocio/*.py ./src/workers/ocio/

COPY start.sh ./
RUN dos2unix start.sh && chmod +x start.sh

# Build identity.
#
# `.github/workflows/release.yml` passes these three values as build-args. Docker silently
# ignores an undeclared build-arg, so without these `ARG`s every published image would report
# "commit: null, builtAt: null" on /api/version. Declared here, at the very bottom, so they do
# not invalidate the cache of the dependency layers: they change on every build.
#
# The studio's `.env`, loaded by compose, takes precedence over these values on purpose:
# `scripts/update.sh` rewrites APP_VERSION there on every switch, registry mode included.
ARG APP_VERSION=
ARG GIT_SHA=
ARG BUILD_DATE=
ENV APP_VERSION=$APP_VERSION \
    GIT_SHA=$GIT_SHA \
    BUILD_DATE=$BUILD_DATE

# ⚠ Neither /app nor node_modules belongs to `node`, on purpose. The application never writes
# into its own directory: the worker's intermediate files go through `os.tmpdir()` (/tmp,
# world-writable) and everything else goes to MinIO or Postgres.
USER node

EXPOSE 3000
CMD ["./start.sh"]
