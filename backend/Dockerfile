# ReView 2.0 backend — Node 22 (glibc) pour compat. binaires (ffmpeg, prisma) + AWS SDK v3
#
# DEUX ÉTAPES, comme frontend/Dockerfile. L'image d'exécution n'embarque ni les sources
# TypeScript, ni les devDependencies (typescript, vitest, eslint, tsx, supertest…), et ne
# tourne pas en root. Le worker exécute ffmpeg, assimp et Blender sur des fichiers déposés
# par des utilisateurs : une exécution de code obtenue par cette surface disposait jusqu'ici
# de l'uid 0, d'un compilateur, d'un exécuteur TypeScript et du CLI Prisma — donc d'un accès
# direct à la base.

# ── Étape 1 : construction ────────────────────────────────────────────────────────────────
FROM node:22-slim AS build

WORKDIR /app

# openssl : `prisma generate` s'en sert pour choisir le moteur de requête de la plateforme.
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# package.json + schéma avant l'installation : le hook postinstall (prisma generate) a
# besoin du schéma, et la couche d'installation reste en cache tant qu'ils ne changent pas.
COPY package*.json ./
COPY prisma ./prisma
# `npm ci` et non `npm install` : la construction doit rendre EXACTEMENT l'arbre du
# lockfile, sinon deux images bâties à deux dates n'exécutent pas le même code.
RUN npm ci

COPY . .

# Compile le TypeScript → dist/ (et prisma/seed.ts → dist/seed.js, cf. `build:seed`).
RUN npm run build

# ── Étape 2 : exécution ───────────────────────────────────────────────────────────────────
FROM node:22-slim

# L'image embarque aussi des programmes tiers sous leur propre licence — FFmpeg toujours,
# Blender et usd-core avec INSTALL_USD_TOOLS=1, tous deux GPL-2.0-or-later : qui redistribue
# cette image doit relayer leur offre de source. Voir DOCUMENTATION/development/licensing.md.
LABEL org.opencontainers.image.title="ReView (backend)" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.source="https://github.com/YvigUnderscore/ReView"

WORKDIR /app

# Dépendances système : openssl (Prisma), ffmpeg (transcode/miniatures),
# assimp-utils (conversion 3D FBX/OBJ/USD → GLB, 9.A1), dos2unix (start.sh),
# fonts-dejavu-core (drawtext des burn-ins/slates 35.A — sans fonte, drawtext échoue)
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ffmpeg assimp-utils dos2unix ca-certificates fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

# 39.A — convertisseur USD→glTF natif (guc) préservant matériaux UsdPreviewSurface & variantes.
# OPTIONNEL et opt-in : fournir l'URL d'une release guc auto-suffisante (Linux x86_64) via
# `--build-arg GUC_URL=…`. Sans URL (défaut), l'image est inchangée et le worker se rabat sur
# assimp (support USD expérimental). Une fois installé, activer avec l'env `USD_GLTF_CONVERTER=guc`
# du service worker (docker-compose). Voir DOCUMENTATION/admin-guide/3d-usd.md.
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

# 45.D — outillage USD du worker, **opt-in** : `--build-arg INSTALL_USD_TOOLS=1`.
#  - Blender headless : conversion USD→GLB avec OpenUSD complet (composition des références,
#    payloads et variantes, matériaux UsdPreviewSurface, UsdSkel animé, caméras).
#  - venv `usd-core` : runtime OpenUSD Python pour l'analyse (couche racine d'une archive,
#    variantes/purposes, assets non résolus) — Blender n'expose pas le module `pxr`.
# Seul le service `worker` du compose passe cet argument : l'image de l'API reste inchangée.
# Coût mesuré quand il est activé : image 1,6 Go → 3,6 Go (Blender 1,1 Go, venv usd-core
# 234 Mo, + les bibliothèques X/GL contre lesquelles Blender est lié). Sans lui, l'USD
# retombe sur guc/assimp (et échoue si aucun des deux ne sait lire l'USD).
# Voir DOCUMENTATION/admin-guide/3d-usd.md.
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
      && /opt/usdenv/bin/python3 -c "import pxr; print('usd-core prêt')" \
      && rm -rf /var/lib/apt/lists/*; \
    fi

# Dépendances d'EXÉCUTION seules. `prisma` est une dependency (et non une devDependency) :
# start.sh invoque le CLI à chaque démarrage pour `migrate deploy`, il ne peut donc pas être
# élagué. Le postinstall génère ici le client Prisma, une fois pour toutes — le conteneur
# n'aura plus à le refaire (ni le droit : node_modules appartient à root).
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Scripts Python du worker (conversion et analyse USD, cuisson de LUT OCIO). Ils sont
# résolus à l'exécution sous `src/workers/…` (ModelConvertService.ts, ocio/bakeRunner.ts) :
# ce sont des ressources, pas du TypeScript, et tsc ne les copie pas dans dist/.
COPY src/workers/usd/*.py ./src/workers/usd/
COPY src/workers/ocio/*.py ./src/workers/ocio/

COPY start.sh ./
RUN dos2unix start.sh && chmod +x start.sh

# Identité de la construction.
#
# `.github/workflows/release.yml` passe ces trois valeurs en build-args depuis toujours,
# mais aucun `ARG` ne les recevait : Docker ignore silencieusement un build-arg non déclaré.
# Toute image publiée répondait donc « commit: null, builtAt: null » sur /api/version — et
# l'écran d'administration aurait affiché deux champs vides dès le premier jour. Déclarés
# ici, tout en bas, pour ne pas invalider le cache des couches de dépendances à chaque
# version : elles changent à chaque construction, pas le reste.
#
# Le `.env` du studio, chargé par compose, l'emporte sur ces valeurs — c'est voulu :
# `scripts/update.sh` y réécrit APP_VERSION à chaque bascule, y compris en mode registre.
ARG APP_VERSION=
ARG GIT_SHA=
ARG BUILD_DATE=
ENV APP_VERSION=$APP_VERSION \
    GIT_SHA=$GIT_SHA \
    BUILD_DATE=$BUILD_DATE

# ⚠ Ni /app ni node_modules n'appartiennent à `node` : c'est voulu. L'application n'écrit
# jamais dans son propre répertoire — les fichiers intermédiaires du worker passent par
# `os.tmpdir()` (/tmp, monde-inscriptible) et tout le reste va dans MinIO ou Postgres.
USER node

EXPOSE 3000
CMD ["./start.sh"]
