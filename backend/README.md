# ReView 2.0 — Backend

Node.js + **Express 5** + **TypeScript** + Prisma (**PostgreSQL**) + **MinIO** (S3) + **Redis/BullMQ** + Socket.io.

## Structure (`src/`)

```
config/env.ts          Validation Zod des variables d'environnement (fail-fast)
lib/                   prisma, redis, jwt, errors, sanitize, fileSignatures (magic bytes), bigintJson
middleware/            auth (JWT + zombie-token), rbac, validate (Zod), error, rateLimit
services/              StorageService (MinIO), SocketService, JobService (BullMQ)
workers/               ffmpeg.worker.ts (squelette — 8.3)
routes/                un fichier par domaine ; stubs 501 pour les domaines à venir
server.ts / app.ts     bootstrap + montage Express
prisma/schema.prisma   schéma pipeline (Studio > Projet > Séquence > Shot > Task > Version > MediaObject)
prisma/seed.ts         seed de dev
```

> Les fichiers `*.routes.js` / `services/*.js` à la racine de `backend/` sont le **legacy v1**
> (en quarantaine, non importés). Ils seront réécrits/supprimés au fil des sous-phases.

## RBAC

Rôles globaux sur `User` : `ADMIN`, `SUPERVISOR`, `ARTIST`, `CLIENT`.
Accès projet : ADMIN/SUPERVISOR global ; ARTIST/CLIENT via `ProjectMembership`.

## Démarrage (dev local)

```bash
# 1. Lancer les services d'infra
docker compose up -d postgres minio redis

# 2. Configurer l'environnement
cp ../.env.example ../.env   # puis renseigner JWT_SECRET
# backend/.env contient déjà des valeurs de dev local

# 3. Dépendances + client Prisma (postinstall) + schéma
npm install
npm run prisma:migrate      # crée la migration initiale + applique
npm run seed                # studio + admin + projet de démo

# 4. Lancer l'API
npm run dev                 # http://localhost:3000  (GET /health)
```

## Scripts

| Script | Rôle |
|--------|------|
| `npm run dev` | API en watch (tsx) |
| `npm run build` | `prisma generate` + `tsc` → `dist/` |
| `npm start` | exécute `dist/server.js` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | tests Vitest |
| `npm run seed` | seed de dev |
| `npm run storage:smoke` | smoke test du StorageService (MinIO) |
| `npm run prisma:studio` | explorateur DB |

## Comptes de seed

- Admin : `admin@review.local` / `admin1234`
- Artiste : `artist@review.local` / `artist1234`
