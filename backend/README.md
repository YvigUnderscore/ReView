# ReView — Backend

Node.js 22 + **Express 5** + **TypeScript** + Prisma (**PostgreSQL**) + **MinIO** (S3) +
**Redis/BullMQ** + Socket.io. The same image runs two processes: the API (`src/server.ts`) and
the media worker (`src/workers/`).

## Layout (`src/`)

```
config/env.ts          Zod validation of the environment (fail-fast; shared by API and worker)
lib/                   domain helpers: prisma, redis, jwt, errors, health, hls, crypto, email,
                       fileSignatures (magic bytes), openapi, publishLock, … (tests colocated)
middleware/            auth (JWT), rbac, scope, validate (Zod), rateLimit, httpLogger, error
services/              business logic, one service per domain (Storage, Job, Socket, Media, …)
routes/                one file per domain, ≤ 200 lines each
workers/               BullMQ workers: ffmpeg (media processing), maintenance, shotgrid,
                       webhook, timelineExport, spatialThumb, storageCleanup; usd/, ocio/
i18n/                  server-side message catalogues (emails, exports, server-rendered pages)
integration/           integration tests (*.itest.ts, need the docker stack)
server.ts / app.ts     bootstrap + Express wiring
prisma/schema.prisma   schema (Studio > Project > Episode > Sequence > Shot/Asset > Task > Version > MediaObject)
prisma/migrations/     versioned migrations, applied at container start by start.sh
prisma/seed.ts         development seed
```

Where each kind of code belongs, and how a feature crosses the stack:
[`DOCUMENTATION/development/code-structure.md`](../DOCUMENTATION/development/code-structure.md).

## RBAC

Global roles on `User`: `ADMIN`, `SUPERVISOR`, `ARTIST`, `CLIENT`. Project access is global
for ADMIN/SUPERVISOR and through `ProjectMembership` for ARTIST/CLIENT; a membership may
override the global role for that project. Details:
[`DOCUMENTATION/infrastructure/security.md`](../DOCUMENTATION/infrastructure/security.md#authorization-the-effective-project-role).

## Getting started (local development)

```bash
# 1. Start the infrastructure services (the dev override publishes them on 127.0.0.1)
docker compose up -d postgres minio redis

# 2. Environment: `dotenv` reads backend/.env (not versioned). Minimal content:
#    DATABASE_URL=postgresql://review:review_dev@localhost:5432/review?schema=public
#    REDIS_URL=redis://localhost:6379
#    S3_ENDPOINT=http://localhost:9000
#    S3_ACCESS_KEY=minioadmin
#    S3_SECRET_KEY=minioadmin
#    JWT_SECRET=<at least 16 characters>

# 3. Dependencies + Prisma client (postinstall) + schema
npm install
npm run prisma:migrate      # applies the existing migrations (prisma migrate dev)
npm run build               # also compiles prisma/seed.ts to dist/seed.js
npm run seed                # studio + admin + demo project

# 4. Run the API
npm run dev                 # http://localhost:3000  (GET /health)
```

Every variable, with its default and its production constraint:
[`DOCUMENTATION/getting-started/installation.md`](../DOCUMENTATION/getting-started/installation.md#environment-variables).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | API in watch mode (tsx) |
| `npm run build` | `prisma generate` + `tsc` → `dist/`, plus the compiled seed |
| `npm start` | runs `dist/server.js` |
| `npm run typecheck` | `tsc --noEmit`, tests included (`tsconfig.eslint.json`) |
| `npm run lint` / `lint:fix` | ESLint, zero warnings allowed |
| `npm run format` / `format:check` | Prettier |
| `npm test` | Vitest unit tests |
| `npm run test:integration` | Vitest integration tests (docker stack required) |
| `npm run seed` | development seed (`dist/seed.js` — build first) |
| `npm run storage:smoke` | StorageService smoke test against MinIO |
| `npm run prisma:migrate` / `prisma:deploy` | `prisma migrate dev` / `prisma migrate deploy` |
| `npm run prisma:studio` | database explorer |

Before any commit, run the whole suite from the repository root: `bash scripts/validate.sh`
(see [`DOCUMENTATION/development/validation-and-tests.md`](../DOCUMENTATION/development/validation-and-tests.md)).

## Seed accounts

- Admin: `admin@review.local` / `admin1234`
- Artist: `artist@review.local` / `artist1234`

Development only — never expose a seeded instance.
