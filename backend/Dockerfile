# ReView 2.0 backend — Node 22 (glibc) pour compat. binaires (ffmpeg, prisma) + AWS SDK v3
FROM node:22-slim

WORKDIR /app

# Dépendances système : openssl (Prisma), ffmpeg (transcode/miniatures),
# assimp-utils (conversion 3D FBX/OBJ/USD → GLB, 9.A1), dos2unix (start.sh),
# fonts-dejavu-core (drawtext des burn-ins/slates 35.A — sans fonte, drawtext échoue)
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ffmpeg assimp-utils dos2unix ca-certificates fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

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
