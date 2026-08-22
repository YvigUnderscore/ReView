# Docker stack

> Updated: 2026-08-22

`docker-compose.yml` defines **six services started by default**, three more behind
opt-in profiles, and six named volumes. `docker-compose.override.yml` (development,
auto-loaded) and `docker-compose.prod.yml` (production, explicit) layer on top.

## Default services

| Service | Image / build | Role |
|---------|---------------|------|
| `postgres` | `postgres:16-alpine` | Primary database (Prisma schema). No host port in the base file |
| `minio` | `minio/minio:RELEASE.2025-04-22T22-12-26Z` (pinned, override with `MINIO_VERSION`) | S3-compatible object storage for every binary (originals, HLS renditions, thumbnails, attachments, HDRIs) |
| `redis` | `redis:7-alpine` | BullMQ queue backend. No host port in the base file, no password |
| `backend` | built from `backend/` | Express 5 API + Socket.io realtime server. Host port `BPORT` → container `3000` |
| `worker` | built from `backend/`, `command: node dist/workers/ffmpeg.worker.js` | One process, five BullMQ workers: media processing (FFmpeg/Blender/assimp), storage cleanup, outgoing webhook delivery, timeline export and ShotGrid synchronisation |
| `frontend` | built from `frontend/Dockerfile` (context = repo root) | React app built by Vite, served by nginx; proxies `/api/` and `/socket.io/` to the backend. Host port `PORT` → container `80` |

`backend` and `worker` are built from the **same** image definition. Only the worker
passes `INSTALL_USD_TOOLS` (default `1`), which adds Blender and a `usd-core` virtualenv
and takes the image from ~1.6 GB to ~3.6 GB. Set `INSTALL_USD_TOOLS=` in `.env` to build
the light image (USD then falls back to `guc`/assimp, and fails if neither can read it).

## Profile services

```bash
docker compose --profile monitoring up -d
docker compose --profile antivirus up -d
```

| Service | Profile | Role |
|---------|---------|------|
| `prometheus` | `monitoring` | Scrapes `backend:3000/metrics` and `worker:9101/metrics` every 15 s, and evaluates the alert rules of `monitoring/rules/` (`monitoring/prometheus.yml`) |
| `grafana` | `monitoring` | Dashboard on `GRAFANA_BIND:GRAFANA_PORT` (default `127.0.0.1:3431`). Sign-up and anonymous access disabled |
| `clamav` | `antivirus` | `clamav/clamav:stable`. Point `CLAMAV_HOST=clamav` at it on `backend` **and** `worker` |

## Startup order and healthchecks

Every service declares `restart: always`. Dependencies are gated on health, not on
container start:

| Service | Healthcheck | Waits for |
|---------|-------------|-----------|
| `postgres` | `pg_isready -U $POSTGRES_USER`, 5 s / 5 s / 10 retries | — |
| `minio` | `mc ready local`, 5 s / 5 s / 10 retries | — |
| `redis` | `redis-cli ping`, 5 s / 5 s / 10 retries | — |
| `backend` | `fetch('http://127.0.0.1:3000' + HEALTH_PATH)`, default `/health`, 10 s / 5 s / 10 retries, `start_period: 40s` | `postgres`, `minio`, `redis` healthy |
| `worker` | none | `postgres`, `minio`, `redis` healthy **and `backend` healthy** |
| `frontend` | `wget /index.html`, 30 s / 5 s / 5 retries | `backend` healthy |
| `clamav` | `clamdscan --ping 1`, 30 s / 10 s / 10 retries, `start_period: 180s` | — |

`/health` is a liveness probe by design — a container is not restarted because Postgres
is down. Set `HEALTH_PATH=/health/ready` in `.env` to make the container health status
follow the dependencies instead; see
[Monitoring & operations](../infrastructure/monitoring.md#health-probes).

The worker waiting on the backend healthcheck is deliberate: the backend applies the
Prisma migrations during boot (`backend/start.sh`), so the worker never talks to an
un-migrated schema. The 40 s `start_period` exists for the same reason.

Both `backend` and `worker` declare `extra_hosts: host.docker.internal:host-gateway`
so the ShotGrid development simulator running on the host machine is reachable.

## Data flow

1. The browser talks only to the **frontend** nginx (`:3429`), which serves the SPA and
   proxies API/WebSocket traffic to the backend.
2. Uploads never transit through the API: the backend issues a **presigned URL** and the
   browser writes straight to **MinIO**. Object keys are stored in PostgreSQL
   (`MediaObject.storageKey`).
3. On finalize, the backend enqueues a processing job in **Redis**; the **worker** picks
   it up (FFmpeg, Blender, assimp…), writes derived files back to MinIO and moves the
   media through `UPLOADING → PROCESSING → READY | FAILED`.
4. Realtime events (presence, notifications, media status, live review) are pushed over
   **Socket.io**.

## Volumes

| Volume | Content | Backed up by `scripts/backup.sh` |
|--------|---------|-----------------------------------|
| `pgdata` | PostgreSQL data | yes (`pg_dump -Fc`) |
| `miniodata` | All media objects | yes (incremental mirror + hard-linked snapshot; `BACKUP_MODE=archive` for a whole-volume tar) |
| `redisdata` | Queue state | no — rebuildable |
| `clamav_db` | ClamAV virus database (profile) | no |
| `prometheus_data` | Metrics TSDB (profile) | no |
| `grafana_data` | Grafana state (profile) | no |

Back up `pgdata` + `miniodata` **together**: the database references MinIO object keys.
See [Backups & restore](../infrastructure/backups.md).

## Everyday commands

```bash
docker compose ps                                # state of every service
docker compose logs -f backend worker            # follow both application logs
docker compose exec postgres psql -U review -d review -c '\dt'
docker compose exec backend npx prisma migrate status
docker compose restart worker                    # after changing VIDEO_ENCODER
docker compose up -d --build backend worker      # rebuild only the Node images
docker compose down                              # stop (volumes are kept)
docker compose down -v                           # stop AND destroy all data
```

Scaling the worker (it is stateless and pulls from the same Redis):

```bash
docker compose up -d --scale worker=3
```

## Frontend build context

The frontend image is built with the **repo root** as Docker context
(`build.context: .`, `dockerfile: frontend/Dockerfile`) so the build can copy
`DOCUMENTATION/` next to the frontend sources and embed it into the app (`/docs` page,
via the `prebuild` script). The root `.dockerignore` keeps that context small.

## Overlays

| File | Loaded | Effect |
|------|--------|--------|
| `docker-compose.override.yml` | automatically by `docker compose up` | Publishes PostgreSQL and Redis on `DEV_BIND` (default `127.0.0.1`), forces `NODE_ENV=development` on `backend` and `worker` |
| `docker-compose.prod.yml` | only with an explicit `-f` | Adds the TLS `nginx` service, removes every host port from `frontend`/`backend`/`minio`, makes the critical secrets mandatory |
| `docker-compose.release.yml` | only with an explicit `-f` | Runs the **published images** (`REVIEW_IMAGE_PREFIX`/`REVIEW_IMAGE_TAG`) instead of building them on the server |
| `deploy/compose.site.yml` | written by `scripts/install.sh` | Everything specific to this site: the rendered nginx configuration, and the volumes bind-mounted under `DATA_ROOT` |

```bash
# development
docker compose up -d
# production — both -f flags, always
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

On an instance created by `scripts/install.sh` this is settled once and for all: the
installer writes `COMPOSE_FILE` (plus `COMPOSE_PATH_SEPARATOR=:`) into `.env` with the
exact list of files, so a bare `docker compose up -d` starts the right stack and cannot
fall back to the development overlay.

## Related pages

- [Installation](installation.md) — environment variables, ports, production guards
- [Updating](updating.md) — published images, rollback
- [Architecture](../infrastructure/architecture.md)
- [Jobs & workers](../infrastructure/jobs-and-workers.md)
- [MinIO storage](../infrastructure/storage-minio.md)
- [Monitoring & operations](../infrastructure/monitoring.md)
