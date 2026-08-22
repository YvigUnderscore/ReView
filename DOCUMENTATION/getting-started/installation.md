# Installation

> Updated: 2026-08-22

ReView ships as a Docker Compose stack: one instance = one studio. Everything
(database, object storage, job queue, backend, worker, frontend) runs from a single
`docker compose up`.

## Prerequisites

- Docker Engine + Docker Compose v2 (**≥ 2.24** — the production overlay uses the
  `!reset` list operator, see [Production deployment](#production-deployment))
- Around 4 GB of free RAM for the stack, plus disk space for your media
- (Development only) Node.js 22+ and npm. Both images pin Node 22
  (`backend/Dockerfile`: `node:22-slim`, `frontend/Dockerfile`: `node:22-alpine`);
  Vite 7 no longer supports Node 18.

## Install a studio instance

```bash
git clone https://github.com/YvigUnderscore/ReView.git ReView-app
cd ReView-app
bash scripts/install.sh
```

The installer asks four questions — domain, TLS mode, timezone, where the data lives —
and does everything else: it generates every secret with `openssl rand -hex 32`, writes
`.env`, creates the data directories, renders the nginx configuration for your domain,
obtains or generates a certificate, starts the stack, waits until the API reports its
dependencies healthy, and prints the URL of the setup wizard.

Nothing has to be edited by hand, and **no versioned file is modified**: the site-specific
output goes to `.env` and `deploy/` (rendered `nginx.conf` plus a compose overlay), so a
later `git pull` or `git checkout vX.Y.Z` still applies cleanly.

Non-interactive (for a configuration-managed host):

```bash
bash scripts/install.sh --non-interactive \
  --domain review.studio.tld --tls letsencrypt --email ops@studio.tld \
  --timezone Europe/Paris --data-root /mnt/pool/review
```

| Option | Values | Notes |
|--------|--------|-------|
| `--tls letsencrypt` | | Runs certbot standalone; port 80 must be free and DNS must already point here |
| `--tls selfsigned` | | Works immediately, browsers warn. Fine to start with, switch later |
| `--tls existing` | | Expects `nginx/certs/fullchain.pem` + `privkey.pem` |
| `--tls none` | | No bundled front: the app is served in clear on `PORT` and MinIO on `MINIO_API_PORT`, for a host that already has a TLS proxy. That proxy must route `/api/`, `/socket.io/` and the bucket |
| `--data-root <path>` | | Bind-mounts the Postgres, MinIO and Redis volumes there. On a NAS, point it at the data pool — otherwise media land in `/var/lib/docker/volumes`, i.e. the system pool. Choose it now: moving it later means stopping the stack, copying the volumes and recreating them |
| `--force` | | Reinstall over an existing `.env` (the old one is kept as `.env.backup-<timestamp>`) |

The installer writes `COMPOSE_FILE` (and `COMPOSE_PATH_SEPARATOR=:`) into `.env`, listing
exactly the compose files of this instance. Consequence worth knowing: from then on a bare
`docker compose up -d` starts **your** stack, and the classic mistake — forgetting the
second `-f`, which silently reloads the development overlay and turns the guards off — is
no longer possible.

Certificate renewal is not automated by the installer. With `--tls letsencrypt` the
account and certificates live in `deploy/letsencrypt/`; renew with the same container and
reload nginx:

```bash
docker run --rm -p 80:80 -v "$PWD/deploy/letsencrypt:/etc/letsencrypt" certbot/certbot renew
cp deploy/letsencrypt/live/<domain>/{fullchain,privkey}.pem nginx/certs/
docker compose restart nginx
```

## Quick start (development)

```bash
git clone https://github.com/YvigUnderscore/ReView.git ReView-app
cd ReView-app
cp .env.example .env
docker compose up -d --build
```

`docker compose up` **auto-loads `docker-compose.override.yml`**, which is the
development overlay: it exposes PostgreSQL (`5432`) and Redis (`6379`) on the loopback
interface and forces `NODE_ENV=development` on `backend` and `worker`, which disables
the production guards described below. Never deploy with that overlay — see
[Production deployment](#production-deployment).

Watch the stack come up:

```bash
docker compose ps
docker compose logs -f backend
```

The backend is ready when it logs `✅ ReView 2.0 backend démarré sur le port 3000`.
Check it directly:

```bash
curl -s http://localhost:3430/health          # liveness — is the process up?
curl -s http://localhost:3430/health/ready    # readiness — Postgres, Redis, MinIO
```

```json
{ "status": "ok", "version": "2.3.0", "commit": "a1b2c3d4e5f6", "uptimeSec": 12 }
```

`/health/ready` answers `503` while a dependency is missing, and names the culprit. Both
routes are also mounted under `/api/`, which is the only prefix the production front
proxies — external monitoring must target `https://<domain>/api/health/ready`. Details:
[Monitoring & operations](../infrastructure/monitoring.md#health-probes).

Then open **http://localhost:3429**. On a fresh database the app redirects to the
`/setup` page to create the studio and the first administrator account
(see [First run](first-run.md)).

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
`PORT: 3000` hard-coded by the compose file. `backend/src/config/env.ts` defaults
`PORT` to `3000` for a bare `npm run dev` outside Docker.

MinIO and, under the development overlay, PostgreSQL/Redis listen on `127.0.0.1` on
purpose: the MinIO console is a full storage administration UI and Redis has no
password at all. Set `MINIO_BIND=0.0.0.0` / `DEV_BIND=0.0.0.0` only when you knowingly
want LAN access.

## Environment variables

The backend validates its whole environment with Zod at boot
(`backend/src/config/env.ts`) and calls `process.exit(1)` with the offending field
names if anything is invalid. The **worker shares the same schema**, so every variable
below applies to both containers.

### Required

| Variable | Constraint |
|----------|-----------|
| `DATABASE_URL` | non-empty PostgreSQL connection string |
| `JWT_SECRET` | ≥ 16 characters; in production ≥ 32 and not a `change_me`-style placeholder |
| `S3_ENDPOINT` | non-empty (endpoint the backend/worker use internally) |
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

There is no `MINIO_*` variable on the backend side: `MINIO_ROOT_USER` /
`MINIO_ROOT_PASSWORD` are read by the `minio` container itself, and the compose file
passes them through to the backend as `S3_ACCESS_KEY` / `S3_SECRET_KEY`.

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

These live in `.env` but are consumed by `docker-compose*.yml` or by the scripts, not
by `config/env.ts`:

`PORT`, `BPORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`,
`MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_API_PORT`, `MINIO_CONSOLE_PORT`,
`MINIO_BIND`, `DEV_BIND`, `POSTGRES_PORT`, `REDIS_PORT`, `INSTALL_USD_TOOLS`,
`GRAFANA_PORT`, `GRAFANA_BIND`, `GRAFANA_ADMIN_PASSWORD`, and — for
`scripts/backup.sh` / `scripts/restore.sh` — `COMPOSE_PROJECT`, `BACKUP_KEEP` and
`BACKUP_MODE`.

Written by `scripts/install.sh` and `scripts/update.sh`:

| Variable | Written by | Purpose |
|----------|-----------|---------|
| `COMPOSE_FILE` | install | The exact compose files of this instance; makes a bare `docker compose` correct |
| `COMPOSE_PATH_SEPARATOR` | install | `:` — pinned because the default separator is OS-dependent (`;` on Windows) |
| `SITE_DOMAIN` | install | Domain the nginx configuration was rendered for |
| `DATA_ROOT` | install | Host path bind-mounted by the volumes of `deploy/compose.site.yml` |
| `APP_VERSION` | install, update | Version the instance reports (`/api/version`, About panel, metrics) |
| `REVIEW_IMAGE_PREFIX` | operator | Registry prefix, e.g. `ghcr.io/yvigunderscore`. Its presence switches `update.sh` to registry mode |
| `REVIEW_IMAGE_TAG` | update | Image tag currently deployed (required by `docker-compose.release.yml`) |

## Production deployment

Production runs **without** the development override and **with** the production
overlay. Both `-f` flags are mandatory:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Omitting the second `-f` silently puts the instance back into development mode
(`NODE_ENV=development`, guards off, PostgreSQL and Redis republished).

The overlay:

- adds an `nginx` service terminating TLS on `80`/`443` (certificates read from
  `./nginx/certs/fullchain.pem` and `privkey.pem`);
- removes **every** host port from `frontend`, `backend` and `minio` (`ports: !reset []`),
  so nginx is the only exposed service; MinIO is reached through
  `https://<domain>/<bucket>/…`, its console only over an SSH tunnel or VPN;
- turns the critical variables into hard requirements (`${VAR:?…}`): `POSTGRES_PASSWORD`,
  `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `JWT_SECRET`, `CORS_ORIGIN`,
  `S3_PUBLIC_ENDPOINT` — compose refuses to start without them.

`config/env.ts` then re-checks the same ground at boot and refuses to start when
`NODE_ENV=production` and any of the following holds:

| Rejected | Message |
|----------|---------|
| `JWT_SECRET` shorter than 32 chars or matching `change_me` / `changeme` / `secret_change` | weak/default secret forbidden |
| `CORS_ORIGIN` equal to `*` | exact origins required |
| `S3_ACCESS_KEY` or `S3_SECRET_KEY` equal to `minioadmin` | default credentials forbidden |
| `APP_ENCRYPTION_KEY` set but weak | same rule as `JWT_SECRET` |

Generate secrets with `openssl rand -hex 32`. The step-by-step server guide
(certificates, domain, firewall) is `DEPLOYMENT.md` at the repository root.

## Optional profiles

```bash
docker compose --profile monitoring up -d    # Prometheus + Grafana
docker compose --profile antivirus up -d     # ClamAV (first start downloads the virus DB)
```

See [Monitoring & operations](../infrastructure/monitoring.md).

## Updating

```bash
bash scripts/update.sh --version v2.3.0
```

Backup, switch, migrations, health check, and automatic rollback if the readiness probe
fails. The full procedure — including what a rollback can and cannot undo — is on its own
page: [Updating](updating.md).

The frontend image embeds the product documentation (`DOCUMENTATION/` → `/docs` page),
so a new frontend image refreshes the in-app docs as well.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Backend exits immediately, stderr lists field names | Zod env validation failed | Fix the named variables in `.env`, recreate the container |
| Backend restarts in a loop with `Échec du démarrage du serveur` | `storage.ensureBucket()` runs **before** the HTTP listener; MinIO unreachable | Check `docker compose logs minio`; the backend retries via `restart: always` |
| Worker refuses to start in production | The worker shares the backend env schema and rejects `CORS_ORIGIN=*` | Set the same `CORS_ORIGIN` on the worker (the compose file already does) |
| Presigned URLs point at an unreachable host | `S3_PUBLIC_ENDPOINT` still `http://localhost:9000` | Set it to the public HTTPS origin |
| `502` on `/api/` after restarting only the backend | nginx cached the old container IP | The bundled `frontend/nginx.conf` re-resolves via `resolver 127.0.0.11 valid=10s`; a custom front proxy needs the same |

## License obligations

ReView is AGPL-3.0-or-later. Running it unmodified requires nothing from you. If you
**modify** it, section 13 obliges you to offer your sources to everyone who uses the
instance over the network: publish your fork and set its URL in **Admin → Settings →
"Code source (AGPL §13)"** (setting key `studio_source_url`; it falls back to the
upstream repository). Republishing the Docker images also redistributes FFmpeg and,
when built with `INSTALL_USD_TOOLS=1`, Blender — both GPL-2.0-or-later.

See [Licensing](../development/licensing.md) for the details.

## Related pages

- [Docker stack](docker-stack.md) — what each service does
- [First run](first-run.md) — setup page, seed accounts
- [Updating](updating.md) — versions, images, rollback
- [Backups & restore](../infrastructure/backups.md)
- [Architecture](../infrastructure/architecture.md)
- [Security model](../infrastructure/security.md)
- [Licensing](../development/licensing.md) — AGPL obligations, third-party notices
