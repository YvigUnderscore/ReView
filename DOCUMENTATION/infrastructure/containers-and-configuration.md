# Containers & configuration

> Updated: 2026-08-21

How the compose stack is configured, bounded and probed. The companion pages describe
what runs inside it: [Architecture](architecture.md),
[Jobs & workers](jobs-and-workers.md), [Monitoring](monitoring.md).

## Where configuration comes from

`.env` at the repository root is the single operator-facing file. Copy `.env.example`,
which documents **every** variable of `backend/src/config/env.ts` — grouped, commented,
and with the optional ones left commented out rather than emptied.

The `backend` and `worker` services load that file whole:

```yaml
env_file:
  - path: .env
    required: false
```

Before this, both services listed a closed `environment:` block that carried 17 of the
43 variables. `APP_URL`, `SMTP_*`, `VAPID_*`, `APP_ENCRYPTION_KEY`, `LOG_LEVEL` and the
rest never reached the container, so **inviting a collaborator failed on any Docker
install** (`APP_URL_MISSING`) and no email could carry a link.

### Precedence, and why some values are still hard-coded

`environment:` wins over `env_file:`. The values kept in `environment:` are the ones
that describe the **compose network topology**, and they must not be replaced:

| Variable | Value in compose | Why it stays |
|----------|------------------|--------------|
| `DATABASE_URL` | `…@postgres:5432/…` | A developer's `.env` usually points at `localhost` for the Prisma CLI |
| `REDIS_URL` | `redis://redis:6379` | Same reason |
| `S3_ENDPOINT` | `http://minio:9000` | Internal address; the browser uses `S3_PUBLIC_ENDPOINT` |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | `MINIO_ROOT_*` | Derived from the MinIO credentials, one source of truth |
| `PORT` | `3000` | `PORT` in `.env` is the **host** port of the frontend, not the API port |
| `NODE_ENV` | `production` (`development` via the dev override) | Drives the production hardening in `config/env.ts` |

An empty variable is not an absent one: `SMTP_HOST=` makes the backend believe a mail
server is configured. Comment the line out instead.

## Database schema at boot

`backend/start.sh` runs `prisma migrate deploy` and **stops the container if it fails** —
stderr intact, non-zero exit, database untouched.

The script used to end that line with `2>/dev/null || npx prisma db push
--accept-data-loss`. Any failure — a migration marked failed, schema drift, Postgres one
second late — realigned the database on the schema by dropping the columns and tables it
no longer declared, without leaving a trace of why, and `restart: always` replayed it.

Initialising an empty database without versioned migrations is now explicit:

```bash
PRISMA_DB_PUSH=1 docker compose up backend    # or PRISMA_DB_PUSH=1 in .env
```

(The compose file passes that variable through explicitly — Docker Compose does not
forward the host shell environment into containers on its own.)

It is refused when `NODE_ENV=production`, and `db push` runs **without**
`--accept-data-loss`, so it declines by itself as soon as data would be lost.

Recovering from a failed migration: read `npx prisma migrate status` inside the
container, fix or mark the migration resolved, restart. Never point `db push` at a
database that holds work.

## Resource limits and log rotation

Every service carries the same rotation policy (a YAML anchor in `docker-compose.yml`,
repeated inline for the production `nginx` because anchors do not cross compose files):

```yaml
logging:
  driver: json-file
  options: { max-size: "10m", max-file: "5" }
```

The default `json-file` driver writes **without any bound**. On a NAS, an active
instance's pino logs fill the system pool and take the whole appliance down with them —
not just ReView. 10 MB × 5 caps the stack at roughly 450 MB.

Memory ceilings, all overridable in `.env`:

| Service | Default | Rationale |
|---------|---------|-----------|
| `backend` | `BACKEND_MEM_LIMIT=2g` | Single replica, Node heap ≤ ~1.5 GB. The ceiling exists so a leak cannot take the host |
| `worker` | `WORKER_MEM_LIMIT=8g` | Two parallel HLS transcodes and, with `INSTALL_USD_TOOLS=1`, a headless Blender loading a whole USD stage. Below ~4 GB heavy conversions get OOM-killed instead of failing cleanly |
| `postgres` | `POSTGRES_MEM_LIMIT=2g`, `POSTGRES_SHM_SIZE=256mb` | `shared_buffers` stays at its default; `/dev/shm` at the container default of 64 MB makes parallel sorts fail with *could not resize shared memory segment* |

MinIO is deliberately left unbounded: an OOM-killed storage service corrupts an upload
in flight instead of protecting the host. Set `MINIO_MEM_LIMIT` only if the machine
forces your hand.

## Pinned images

Third-party images are pinned, never `latest` — two installations made on two dates must
run the same software, and a `docker compose pull` must not change MinIO's behaviour
under a running studio. Each pin is overridable from `.env`:

| Image | Default | Override |
|-------|---------|----------|
| `minio/minio` | `RELEASE.2025-04-22T22-12-26Z` (last release shipping the full web console) | `MINIO_VERSION` |
| `prom/prometheus` | `v3.5.0` (3.5 LTS line) | `PROMETHEUS_VERSION` |
| `grafana/grafana-oss` | `11.6.1` (the provisioned dashboard is schemaVersion 39) | `GRAFANA_VERSION` |
| `nginx` | `1.27-alpine`, both in `frontend/Dockerfile` and in the production proxy | — |
| `postgres` / `redis` / `clamav` | `16-alpine` / `7-alpine` / `stable` | — |

Upgrading MinIO or Postgres is a **data** operation: read
[MinIO storage](storage-minio.md) and [Backups & restore](backups.md) first.

## Health probes

- **`backend`** — HTTP probe against `127.0.0.1` (not `localhost`: Node's `fetch`
  resolves it to `::1` first, while the server listens on IPv4). The path comes from
  `HEALTH_PATH`, default `/health`.
- **`frontend`** — busybox `wget` on `/index.html`. Without it, an nginx that refused
  its configuration still counted as `running`, and the production proxy sent traffic to
  it.
- **`postgres`, `redis`, `minio`, `clamav`** — native probes; `backend` and `worker`
  gate on them (`condition: service_healthy`).

`/health` remains a **liveness** probe: it answers `ok` without touching Postgres, Redis
or MinIO, so a backend with a dead connection pool still reports healthy. Closing that
gap needs an application-side readiness route (`SELECT 1` + Redis `PING` + MinIO
`statObject`); the container side is ready for it — set `HEALTH_PATH=/health/ready` in
`.env` the day it exists.

## HTTP compression and caching

Neither nginx compressed anything, while `scripts/check-bundle-budget.mjs` measures and
caps the entry bundle **in gzip** (430 kB): browsers were downloading roughly three
times the figure the validation suite tracks. Both `frontend/nginx.conf` and
`nginx/nginx.conf` now carry:

```nginx
gzip on;
gzip_vary on;
gzip_comp_level 5;
gzip_min_length 1024;
gzip_proxied any;
gzip_types text/plain text/css text/javascript text/markdown … application/json …;
```

- `gzip_proxied any` is the decisive line. Its default, `off`, means **no proxied
  response is ever compressed** — and every response of the production proxy is proxied.
- `text/html` is always compressed by nginx and must not be listed. woff2 fonts, images
  and HLS segments are already compressed and are deliberately absent.
- A response already compressed upstream is passed through untouched; nginx never
  double-compresses.
- BREACH: compressing authenticated responses under TLS is exploitable only when
  attacker-controlled input is reflected into a response that carries a secret. ReView
  carries its JWT in the `Authorization` header, never in a response body, and CORS
  forbids cross-origin reads.

Caching follows Vite's content hashes:

| Path | Policy |
|------|--------|
| `/assets/…` | `expires 1y` + `Cache-Control: public, immutable` — the filename changes when the content does, so the browser never even revalidates |
| `/index.html` | `Cache-Control: no-cache` — always revalidated (a `304` when nothing moved), otherwise a deployment would keep serving the previous bundle |
| `/sw.js`, `/manifest.json` | No explicit policy: served with `ETag`/`Last-Modified`, which is what a service worker needs |

## Related pages

- [Architecture](architecture.md)
- [Installation](../getting-started/installation.md)
- [Docker stack](../getting-started/docker-stack.md)
- [Monitoring & operations](monitoring.md)
- [Backups & restore](backups.md)
