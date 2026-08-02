# Installation

> Updated: 2026-07-18

ReView ships as a Docker Compose stack: one instance = one studio. Everything
(database, object storage, job queue, backend, worker, frontend) runs from a single
`docker compose up`.

## Prerequisites

- Docker Engine + Docker Compose v2
- Around 4 GB of free RAM for the stack, plus disk space for your media
- (Development only) Node.js 22+ and npm, required by Vite 7 and the backend toolchain

## Quick start

```bash
git clone <your-repo-url> ReView-app
cd ReView-app
cp .env.example .env    # if present — otherwise create .env (see below)
docker compose up -d --build
```

Then open **http://localhost:3429**. On a fresh database the app redirects to the
`/setup` page to create the studio and the first administrator account
(see [First run](first-run.md)).

## Environment variables

The backend validates its environment with Zod at boot (`backend/src/config/env.ts`)
and refuses to start with missing or weak values in production. Key variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | Backend HTTP port (inside the container) |
| `DATABASE_URL` | — (required) | PostgreSQL connection string |
| `JWT_SECRET` | — (required) | Token signing secret. **≥ 32 random characters in production**; weak/default secrets are rejected |
| `JWT_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | `7d` / `30d` | Access / refresh token lifetimes |
| `REDIS_URL` | `redis://localhost:6379` | Redis (BullMQ job queue) |
| `MINIO_*` | — | MinIO endpoint, credentials and bucket |
| `SMTP_*` | — | Outgoing mail (can also be configured in the admin UI) |

Host port mapping (overridable in `.env`):

| Service | Host port |
|---------|-----------|
| Frontend (nginx) | `3429` (`PORT`) |
| Backend API | `3430` (`BPORT`) |
| MinIO API / console | `9000` / `9001` |

## Updating

```bash
git pull
docker compose up -d --build
```

Database migrations are applied by Prisma on backend startup. The frontend image
embeds the product documentation (`DOCUMENTATION/` → `/docs` page), so rebuilding the
frontend refreshes the in-app docs as well.

## License obligations

ReView is AGPL-3.0-or-later. Running it unmodified requires nothing from you. If you
**modify** it, section 13 obliges you to offer your sources to everyone who uses the
instance over the network: publish your fork and set its URL in **Admin → Settings →
"Code source (AGPL §13)"**. Republishing the Docker images also redistributes FFmpeg and,
when built with `INSTALL_USD_TOOLS=1`, Blender — both GPL-2.0-or-later.

See [Licensing](../development/licensing.md) for the details.

## Related pages

- [Docker stack](docker-stack.md) — what each service does
- [First run](first-run.md) — setup page, seed accounts
- [Architecture](../infrastructure/architecture.md)
- [Licensing](../development/licensing.md) — AGPL obligations, third-party notices
