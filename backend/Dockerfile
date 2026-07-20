# ReView 2.0 backend — Node 22 (glibc) pour compat. binaires (ffmpeg, prisma) + AWS SDK v3
FROM node:22-slim

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

# Copier package.json + le schéma Prisma avant npm install :
# le hook postinstall (prisma generate) a besoin du schéma.
COPY package*.json ./
COPY prisma ./prisma
RUN npm install

COPY . .

# Compile le TypeScript → dist/ (le client Prisma est déjà généré par postinstall)
RUN npm run build

RUN dos2unix start.sh && chmod +x start.sh

EXPOSE 3000
CMD ["./start.sh"]
