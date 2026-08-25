# Installation

*From `git clone` to a running studio: the installer, host ports, every environment variable, and the guards a production instance must pass.*

> Updated: 2026-08-23

ReView ships as a Docker Compose stack, and one instance is one studio. Database, object
storage, job queue, API, media worker and web front all come up from a single
`docker compose up` — there is no cluster to assemble and no external service to sign up for.

Two paths lead there. `scripts/install.sh` produces a working, TLS-terminated instance from
four answers and never touches a versioned file; the manual path exists for a workstation,
for CI, and for the day you want to see exactly which knob does what. This page covers both,
then every variable the two containers read.

## Prerequisites

- **Docker Engine + Docker Compose v2, at least 2.24.** The production overlay uses the
  `!reset` list operator, which older Compose silently ignores — the installer refuses to
  run below that version rather than produce an instance with its host ports still open.
- **Around 4 GB of free RAM** for the stack, plus disk for your media. The worker alone is
  allowed 8 GB (`WORKER_MEM_LIMIT`): two simultaneous HLS transcodes and a headless Blender
  loading a USD scene are what that budget buys.
- **Disk on the right pool.** Decide now where media will live — see `--data-root` below.
- *(Development only)* **Node.js 22+ and npm.** Both images pin Node 22
  (`backend/Dockerfile`: `node:22-slim`, `frontend/Dockerfile`: `node:22-alpine`); Vite 7
  no longer supports Node 18.

## Install a studio instance

```bash
git clone https://github.com/YvigUnderscore/ReView.git ReView-app
cd ReView-app
bash scripts/install.sh
```

The installer asks four questions — domain, TLS mode, timezone, where the data lives — plus
a fifth, the Let's Encrypt contact address, when you choose that TLS mode. Everything else it
does by itself: it draws every secret, writes `.env`, creates the data directories, renders
the nginx configuration for your domain, obtains or generates a certificate, starts the
stack, waits until the API reports its dependencies healthy, and prints the URL of the setup
wizard.

![The installer checks the prerequisites, asks four questions, draws six secrets, writes .env and deploy/, obtains a certificate according to the TLS mode, builds and starts the stack, then polls readiness inside the backend container before printing the setup URL.](../assets/getting-started/install-script-sequence.svg)

Secrets are drawn with `openssl rand -hex 32` when OpenSSL is present, and read from
`/dev/urandom` otherwise — a minimal NAS does not always ship OpenSSL, and an instance that
fell back to a weak secret would be refused at boot by the production guards. Six values are
generated (JWT signing key, encryption key, PostgreSQL password, MinIO password, metrics
token, Grafana password) plus a random MinIO user name, so no default credential survives the
installation.

Non-interactive, for a configuration-managed host:

```bash
bash scripts/install.sh --non-interactive \
  --domain review.studio.tld --tls letsencrypt --email ops@studio.tld \
  --timezone Europe/Paris --data-root /mnt/pool/review
```

| Option | Notes |
|--------|-------|
| `--tls letsencrypt` | Runs certbot standalone; port 80 must be free and DNS must already point here. Requires `--email` |
| `--tls selfsigned` | Works immediately, browsers warn. The default answer, and fine to start with — switch later |
| `--tls existing` | Expects `nginx/certs/fullchain.pem` + `privkey.pem` to be there already |
| `--tls none` | No bundled front at all: read the warning below before choosing it |
| `--timezone <TZ>` | Written as `TZ` in `.env`; drives digest, weekly-report and burn-in timestamps. Defaults to the host's `/etc/timezone`, else UTC |
| `--data-root <path>` | Bind-mounts the Postgres, MinIO and Redis volumes there. On a NAS, point it at the data pool — otherwise media land in `/var/lib/docker/volumes`, i.e. the system pool. Choose it now: moving it later means stopping the stack, copying the volumes and recreating them |
| `--force` | Reinstall over an existing `.env` (the old one is kept as `.env.backup-<timestamp>`) |

> [!CAUTION]
> `--tls none` is for a host that **already** has a TLS proxy in front, and it changes two
> things the other modes never do. The instance is assembled from the base stack plus the
> site overlay only — **the production overlay is not part of it** — so host ports stay
> published on `frontend`, `backend` and `minio`, and the `${VAR:?}` requirements never
> apply. And because no bundled nginx serves the bucket, the installer writes
> `MINIO_BIND=0.0.0.0`, which publishes **both** MinIO ports on every interface: the S3 API
> on 9000 and the full storage administration console on 9001. Firewall that host, and make
> your own proxy route `/api/`, `/socket.io/` and the bucket.

Certificate renewal is not automated by the installer. With `--tls letsencrypt` the account
and certificates live in `deploy/letsencrypt/`; renew with the same container and reload
nginx:

```bash
docker run --rm -p 80:80 -v "$PWD/deploy/letsencrypt:/etc/letsencrypt" certbot/certbot renew
cp deploy/letsencrypt/live/<domain>/{fullchain,privkey}.pem nginx/certs/
docker compose restart nginx
```

## What the installer writes, and what it never touches

**No versioned file is modified.** Everything specific to your site goes to `.env` (mode
`600`) and to `deploy/` — a rendered `nginx.conf` and a compose overlay that binds the volumes
under `DATA_ROOT`. That is what makes a later `git pull` or `git checkout vX.Y.Z` apply
cleanly, and it is the same property `scripts/update.sh` relies on when it refuses to run
with locally modified tracked files.

The installer also writes `COMPOSE_FILE` and `COMPOSE_PATH_SEPARATOR=:` into `.env`, listing
exactly the compose files of this instance:

![The base docker-compose.yml carries every service; development adds the auto-loaded override that turns the production guards off, while production stacks the production overlay, optionally the release overlay, and the site overlay written by the installer.](../assets/getting-started/compose-overlay-stack.svg)

The consequence is worth stating plainly: from then on a bare `docker compose up -d` starts
**your** stack, and the classic mistake — forgetting the second `-f`, which silently reloads
the development overlay and turns the guards off — is no longer possible. The separator is
pinned because its default is OS-dependent (`;` on Windows), so the same `.env` reads the
same way from a developer workstation.

Once the stack is up, schedule a backup. `scripts/backup.sh` dumps PostgreSQL and mirrors the
bucket; `BACKUP_KEEP` (default `7`) sets the rotation and `BACKUP_MODE` chooses between the
walkable mirror and a tar archive. See [Backups & restore](../infrastructure/backups.md).

## Quick start (development)

```bash
git clone https://github.com/YvigUnderscore/ReView.git ReView-app
cd ReView-app
cp .env.example .env
docker compose up -d --build
```

`docker compose up` **auto-loads `docker-compose.override.yml`**, the development overlay: it
publishes PostgreSQL (`5432`) and Redis (`6379`) on the loopback interface and forces
`NODE_ENV=development` on `backend` and `worker`, which disables the production guards
described below. That is exactly what you want on a workstation and exactly what you must
never deploy.

Watch the stack come up:

```bash
docker compose ps
docker compose logs -f backend
```

The backend is ready when it logs `✅ ReView 2.0 backend démarré sur le port 3000`. The two
probes answer different questions, and they do not return the same payload:

```bash
curl -s http://localhost:3430/health          # liveness — is the process up?
curl -s http://localhost:3430/health/ready    # readiness — Postgres, Redis, MinIO
```

```json
{ "status": "ok", "version": "2.3.0", "commit": null, "uptimeSec": 12 }
```

```json
{
  "status": "ready",
  "version": "2.3.0",
  "commit": null,
  "cached": false,
  "checks": {
    "database": { "ok": true, "ms": 3 },
    "redis": { "ok": true, "ms": 1 },
    "storage": { "ok": true, "ms": 12 }
  }
}
```

Readiness answers `503` with `"status": "degraded"` while a dependency is missing, and the
offending entry of `checks` carries the reason. Each check is bounded at 2 s and the whole
report is cached for 5 s, so polling it hard cannot itself finish off a struggling instance.
Script against `status === "ready"` — that is what `install.sh` and `update.sh` test.

Both routes are also mounted under `/api/`, which is the only prefix the production front
proxies, so external monitoring must target `https://<domain>/api/health/ready`. Details:
[Monitoring & operations](../infrastructure/monitoring.md#health-probes).

> [!NOTE]
> `commit` is `null` on a normal instance. It is resolved from `GIT_SHA`/`GIT_COMMIT`, which
> neither the installer nor the update script write and no shipped Dockerfile declares as a
> build argument. `version` is the one to read: `APP_VERSION` is written into `.env` by both
> scripts, and reported by `/api/version`, the About panel and the `review_worker_info` metric.

Then open **http://localhost:3429**. On a fresh database the app redirects to `/setup` to
create the studio and the first administrator account (see [First run](first-run.md)).

## Host ports

Ports are set in `.env` and consumed by `docker-compose.yml`:

| Service | Host port | `.env` variable | Bind address |
|---------|-----------|-----------------|--------------|
| Frontend (nginx) | `3429` | `PORT` | all interfaces |
| Backend API | `3430` | `BPORT` | all interfaces |
| MinIO S3 API | `9000` | `MINIO_API_PORT` | `MINIO_BIND`, default `127.0.0.1` |
| MinIO console | `9001` | `MINIO_CONSOLE_PORT` | `MINIO_BIND`, default `127.0.0.1` |
| PostgreSQL (dev overlay only) | `5432` | `POSTGRES_PORT` | `DEV_BIND`, default `127.0.0.1` |
| Redis (dev overlay only) | `6379` | `REDIS_PORT` | `DEV_BIND`, default `127.0.0.1` |
| Grafana (`monitoring` profile) | `3431` | `GRAFANA_PORT` | `GRAFANA_BIND`, default `127.0.0.1` |

`PORT` is used for two different things and this trips people up: in `.env` it is the
**frontend** host port (`"${PORT:-3429}:80"`), while the backend container receives
`PORT: 3000` hard-coded by the compose file. `backend/src/config/env.ts` defaults `PORT` to
`3000` for a bare `npm run dev` outside Docker.

MinIO and, under the development overlay, PostgreSQL and Redis listen on `127.0.0.1` on
purpose: the MinIO console is a full storage administration UI and Redis has no password at
all. Both bind variables accept `0.0.0.0` when you knowingly want LAN access — and note that
`MINIO_BIND` governs the API and the console together, which is why an installation made with
`--tls none` exposes both.

The production overlay removes every host port from `frontend`, `backend` and `minio`
(`ports: !reset []`), leaving nginx as the only exposed service on `80`/`443`.

## Environment variables

The backend validates its whole environment with Zod at boot (`backend/src/config/env.ts`)
and calls `process.exit(1)` with the offending field names if anything is invalid. The
**worker shares the same schema**, so every variable below applies to both containers — which
is also why the compose file passes the worker the same `CORS_ORIGIN` as the API even though
it serves no HTTP request.

### Required

| Variable | Constraint |
|----------|-----------|
| `DATABASE_URL` | non-empty PostgreSQL connection string |
| `JWT_SECRET` | ≥ 16 characters; in production ≥ 32 and not a `change_me`-style placeholder |
| `S3_ENDPOINT` | non-empty (endpoint the backend and worker use internally) |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | non-empty; in production must not be `minioadmin` |

### Core

| Variable | Default | Purpose |
|----------|---------|---------|
| `NODE_ENV` | `development` | `development` \| `production` \| `test`. `production` enables the hardening guards below |
| `PORT` | `3000` | Backend HTTP port inside the container |
| `LOG_LEVEL` | derived from `NODE_ENV` | `fatal`\|`error`\|`warn`\|`info`\|`debug`\|`trace`\|`silent` (pino) |
| `JWT_EXPIRES_IN` | `7d` | Access token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | `30d` | Refresh token lifetime |
| `ALLOW_SELF_REGISTRATION` | `false` | Enables `POST /api/auth/register`. Closed by default — see [Security model](../infrastructure/security.md) |
| `CORS_ORIGIN` | `*` | Comma-separated origin list. `*` is rejected in production |
| `APP_URL` | *(unset)* | Public URL used to build links in outgoing mail. Without it, links are omitted |
| `APP_ENCRYPTION_KEY` | derived from `JWT_SECRET` (SHA-256) | Encrypts stored secrets (SMTP password, webhook secrets, per-account TOTP secret). Same strength requirement as `JWT_SECRET` in production |

### Object storage

| Variable | Default | Purpose |
|----------|---------|---------|
| `S3_REGION` | `us-east-1` | Signing region |
| `S3_BUCKET` | `review` | Single bucket holding every binary |
| `S3_FORCE_PATH_STYLE` | `true` | Path-style addressing (required by MinIO) |
| `S3_PUBLIC_ENDPOINT` | falls back to `S3_ENDPOINT` | Endpoint used to **sign browser-facing presigned URLs**; usually differs from the internal one |

There is no `MINIO_*` variable on the backend side: `MINIO_ROOT_USER` and
`MINIO_ROOT_PASSWORD` are read by the `minio` container itself, and the compose file passes
them through to the backend as `S3_ACCESS_KEY` / `S3_SECRET_KEY`.

> [!WARNING]
> `S3_BUCKET` is not freely renameable on a TLS-fronted instance. The shipped
> `nginx/nginx.conf` hardcodes the `/review/` prefix twice — once for the HLS segment cache,
> once for the storage proxy — and carries its own warning to adapt both if the bucket name
> differs. Change the name and presigned delivery behind the front stops resolving. The
> installer always writes `S3_BUCKET=review`.

### Queue, mail and notifications

| Variable | Default | Purpose |
|----------|---------|---------|
| `REDIS_URL` | `redis://localhost:6379` | BullMQ connection (compose sets `redis://redis:6379`) |
| `SMTP_HOST` | *(unset)* | Without it, no mail is ever sent |
| `SMTP_PORT` | `587` | |
| `SMTP_SECURE` | `false` | Implicit TLS |
| `SMTP_USER` / `SMTP_PASS` | *(unset)* | Credentials |
| `SMTP_FROM` | `ReView <no-reply@review.local>` | Envelope sender |
| `DIGEST_HOUR` | `7` | Local hour (0–23) of the daily digest, and of the Monday weekly report |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | *(unset)* | Web Push. Without them a keypair is generated and persisted in the database |

SMTP can also be configured from the admin UI, which takes precedence; see
[SMTP & announcements](../admin-guide/smtp-and-announcements.md).

### Worker: media processing

| Variable | Default | Purpose |
|----------|---------|---------|
| `VIDEO_ENCODER` | `libx264` | `libx264` \| `h264_nvenc` |
| `CLAMAV_HOST` | *(unset)* | Enables antivirus scanning. Also read by the backend, which enqueues the `scan` job |
| `CLAMAV_PORT` | `3310` | clamd INSTREAM port |
| `MODEL_CONVERT_TIMEOUT_MS` | `900000` (15 min) | Kill switch for an external converter |
| `USD_BLENDER_BIN` | `/opt/blender/blender` | Blender used for USD → GLB |
| `USD_PYTHON_BIN` | `/opt/usdenv/bin/python3` | `usd-core` interpreter used to analyse USD |
| `USD_GLTF_CONVERTER` | *(unset)* | Native USD→glTF converter (e.g. `guc`); fallback is assimp |
| `USD_MAX_BAKED_VARIANTS` | `512` | Upper bound on variants baked into the GLB |
| `USD_VARIANT_VERTEX_BUDGET` | `8000000` | Vertex budget for baked variants |
| `ARCHIVE_MAX_ENTRIES` | `20000` | 3D archive extraction guard |
| `ARCHIVE_MAX_UNCOMPRESSED_BYTES` | `8589934592` (8 GiB) | Decompression-bomb guard |
| `ARCHIVE_MAX_COMPRESSION_RATIO` | `200` | Decompression-bomb guard |

### Operations and integrations

| Variable | Default | Purpose |
|----------|---------|---------|
| `METRICS_TOKEN` | *(unset)* | Guards `GET /metrics`. Unset = the endpoint is open and must stay on an internal network |
| `SHOTGRID_INSECURE_HOSTS` | *(unset)* | Comma-separated hosts allowed to bypass the HTTPS/public-address check. Development simulator only; logged loudly at every boot |

### Compose-only variables

These live in `.env` but are consumed by `docker-compose*.yml` or by the scripts, not by
`config/env.ts`:

| Variable | Default | What it does |
|----------|---------|--------------|
| `PORT` / `BPORT` | `3429` / `3430` | Host ports of the frontend and the API |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `review` / `review_dev` / `review` | Database credentials, also assembled into `DATABASE_URL` by compose |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | `minioadmin` | MinIO credentials, passed through as the S3 keys |
| `MINIO_API_PORT` / `MINIO_CONSOLE_PORT` / `MINIO_BIND` | `9000` / `9001` / `127.0.0.1` | Where MinIO is published |
| `POSTGRES_PORT` / `REDIS_PORT` / `DEV_BIND` | `5432` / `6379` / `127.0.0.1` | Development overlay only |
| `TZ` | `Europe/Paris` | Timezone of both containers: digests, weekly reports, burn-in timestamps |
| `HEALTH_PATH` | `/health` | Route the **container** healthcheck probes. Set `/health/ready` to make container health follow the dependencies |
| `PRISMA_DB_PUSH` | *(empty)* | `1` initialises an **empty** database with `prisma db push` instead of migrations. Refused when `NODE_ENV=production` |
| `INSTALL_USD_TOOLS` | `1` | Build argument of the worker image: adds Blender and `usd-core` (~1.6 GB → ~3.6 GB) |
| `MINIO_VERSION` / `PROMETHEUS_VERSION` / `GRAFANA_VERSION` | pinned releases | Override the pinned third-party image tags |
| `BACKEND_MEM_LIMIT` / `WORKER_MEM_LIMIT` / `POSTGRES_MEM_LIMIT` | `2g` / `8g` / `2g` | Per-container memory bounds |
| `POSTGRES_SHM_SIZE` | `256mb` | `/dev/shm` for Postgres parallel sorts — 64 MB is not enough |
| `GRAFANA_PORT` / `GRAFANA_BIND` / `GRAFANA_ADMIN_PASSWORD` | `3431` / `127.0.0.1` / `admin` | `monitoring` profile |
| `COMPOSE_PROJECT` / `BACKUP_KEEP` / `BACKUP_MODE` | `review-app` / `7` / `mirror` | Read by `scripts/backup.sh` and `scripts/restore.sh` |

Written by the scripts themselves:

| Variable | Written by | Purpose |
|----------|-----------|---------|
| `COMPOSE_FILE` | install | The exact compose files of this instance; makes a bare `docker compose` correct |
| `COMPOSE_PATH_SEPARATOR` | install | `:` — pinned because the default separator is OS-dependent |
| `SITE_DOMAIN` | install | Domain the nginx configuration was rendered for |
| `DATA_ROOT` | install | Host path bind-mounted by the volumes of `deploy/compose.site.yml` |
| `APP_VERSION` | install, update | Version the instance reports (`/api/version`, About panel, metrics) |
| `REVIEW_IMAGE_PREFIX` | operator | Registry prefix, e.g. `ghcr.io/yvigunderscore`. Its presence switches `update.sh` to registry mode |
| `REVIEW_IMAGE_TAG` | update | Image tag currently deployed (required by `docker-compose.release.yml`) |

Precedence between `env_file`, `environment:` and the shell is spelled out in
[Containers & configuration](../infrastructure/containers-and-configuration.md) — read it
before wondering why a `DATABASE_URL` you set in `.env` did not reach the container.

## Production deployment

An instance installed with `--tls letsencrypt`, `selfsigned` or `existing` is already in
production shape: `COMPOSE_FILE` names the production overlay, so `docker compose up -d` is
enough. Deploying by hand means both `-f` flags, always:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Omitting the second one silently puts the instance back into development mode
(`NODE_ENV=development`, guards off, PostgreSQL and Redis republished).

The overlay adds an `nginx` service terminating TLS on `80`/`443` (certificates read from
`./nginx/certs/fullchain.pem` and `privkey.pem`), removes every host port from `frontend`,
`backend` and `minio` — MinIO is then reached through `https://<domain>/<bucket>/…` and its
console only over an SSH tunnel or a VPN — and turns the critical variables into hard
requirements. A production instance therefore has to pass **two independent gates**, one in
Compose and one at boot:

| Variable | Gate 1 — Compose `${VAR:?}` | Gate 2 — Zod check at boot |
|----------|-----------------------------|----------------------------|
| `JWT_SECRET` | required | ≥ 32 chars, and not `change_me` / `changeme` / `secret_change` |
| `CORS_ORIGIN` | required | `*` rejected — list the exact origins |
| `S3_PUBLIC_ENDPOINT` | required | — |
| `POSTGRES_PASSWORD` | required | — |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | required | — |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | — | `minioadmin` rejected |
| `APP_ENCRYPTION_KEY` | — | same strength rule as `JWT_SECRET` when set; derived from it when absent |

Gate 1 makes `docker compose` refuse to start at all; gate 2 makes the process
`process.exit(1)` with the offending field names on stderr. Gate 2 runs in the **worker** too
— that is why the compose file hands it the same `JWT_SECRET`, `CORS_ORIGIN` and
`S3_PUBLIC_ENDPOINT` as the API, even though it answers no HTTP request.

Generate secrets with `openssl rand -hex 32`. The step-by-step server guide (certificates,
domain, firewall) is `DEPLOYMENT.md` at the repository root.

## Optional profiles

```bash
docker compose --profile monitoring up -d    # Prometheus + Grafana
docker compose --profile antivirus up -d     # ClamAV (first start downloads the virus DB)
```

Prometheus scrapes `backend:3000/metrics` and `worker:9101/metrics` every 15 s; Grafana comes
with the ReView dashboard provisioned and listens on `127.0.0.1:3431` with sign-up and
anonymous access disabled. ClamAV needs `CLAMAV_HOST=clamav` set on **both** `backend` and
`worker` to be used. See [Monitoring & operations](../infrastructure/monitoring.md).

## Updating

```bash
bash scripts/update.sh --version v2.3.0
```

Backup, switch, migrations, health check, and automatic rollback if the readiness probe
fails. The full procedure — including what a rollback can and cannot undo — is on its own
page: [Updating](updating.md).

The frontend image embeds the product documentation (`DOCUMENTATION/` → the `/docs` page), so
a new frontend image refreshes the in-app docs as well.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Backend exits immediately, stderr lists field names | Zod env validation failed | Fix the named variables in `.env`, recreate the container |
| `docker compose up` refuses with a message about a variable | A `${VAR:?}` of the production overlay is unset | Set it in `.env`; the message names it |
| Backend restarts in a loop with `Échec du démarrage du serveur` | `storage.ensureBucket()` runs **before** the HTTP listener; MinIO unreachable | Check `docker compose logs minio`; the backend retries via `restart: always` |
| Backend logs `FATAL: 'prisma migrate deploy' failed` | A migration could not apply; the database was left untouched | `docker compose exec backend npx prisma migrate status`, fix, restart. Never `db push` onto a database that holds data |
| Worker refuses to start in production | The worker shares the backend env schema and rejects `CORS_ORIGIN=*` | Set the same `CORS_ORIGIN` on the worker (the compose file already does) |
| Presigned URLs point at an unreachable host | `S3_PUBLIC_ENDPOINT` still `http://localhost:9000` | Set it to the public HTTPS origin |
| `502` on `/api/` after restarting only the backend | nginx cached the old container IP | The bundled `frontend/nginx.conf` re-resolves via `resolver 127.0.0.11 valid=10s`; a custom front proxy needs the same |
| `docker compose ≥ 2.24 requis` from the installer | Older Compose ignores `!reset` | Upgrade the Compose plugin before installing |

## License obligations

ReView is AGPL-3.0-or-later. Running it unmodified requires nothing from you. If you
**modify** it, section 13 obliges you to offer your sources to everyone who uses the instance
over the network: publish your fork and set its URL in **Admin → Settings → "Code source
(AGPL §13)"** (setting key `studio_source_url`; it falls back to the upstream repository).
Republishing the Docker images also redistributes FFmpeg and, when built with
`INSTALL_USD_TOOLS=1`, Blender — both GPL-2.0-or-later.

See [Licensing](../development/licensing.md) for the details.

## Related pages

- [Docker stack](docker-stack.md) — what each service does, and in which order they start
- [First run](first-run.md) — setup wizard, seed accounts, proving the instance is wired
- [Updating](updating.md) — versions, images, rollback
- [Containers & configuration](../infrastructure/containers-and-configuration.md) — env precedence, limits, logging
- [Backups & restore](../infrastructure/backups.md)
- [Architecture](../infrastructure/architecture.md)
- [Security model](../infrastructure/security.md)
- [Licensing](../development/licensing.md) — AGPL obligations, third-party notices
