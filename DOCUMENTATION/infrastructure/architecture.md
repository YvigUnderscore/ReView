# Architecture

> Updated: 2026-08-21

```
Browser ── nginx (frontend :3429)
              │  static SPA (React 19 / Vite 7)
              │  /api/*  /socket.io/*  ──► backend (Express 5 + Socket.io :3000)
                                              │
                     ┌────────────────────────┼──────────────────┐
                 PostgreSQL 16            Redis 7 (BullMQ)    MinIO (S3)
                 (Prisma ORM)                 │                │
                                          worker (FFmpeg, Blender, assimp, Spark)
```

Media bytes never follow the arrows above: the browser uploads to and reads from MinIO
directly, over presigned URLs issued by the backend after an RBAC check.

## Backend

- **Express 5 + TypeScript**, Prisma ORM on PostgreSQL.
- Layering: routes (thin, ≤ 200 lines: validate → service → respond) → `services/` and
  `lib/` for business logic. Zod validation and RBAC middleware on every route; typed
  errors (`lib/errors`); pino logging with a request id on every response.
- **Socket.io** for realtime: presence, notifications, media processing status, project
  rooms, live review.
- Multi-step writes run in `prisma.$transaction`; MinIO side effects happen after
  commit, and a failed side effect is queued for retry rather than rolled back.

### Boot sequence

`backend/start.sh` → `npx prisma generate` → `npx prisma migrate deploy` (falling back
to `prisma db push --accept-data-loss` when it fails) → `node dist/server.js`.
`server.ts` then:

1. `await storage.ensureBucket()` — creates the bucket and applies the CORS rules;
2. builds the Express app and attaches Socket.io;
3. schedules the daily sweep, the daily digest and the weekly report;
4. `server.listen(PORT)`.

Step 1 comes **before** the listener, which is the single most important operational
consequence of the design: see [failure modes](#failure-modes).

## Worker

A separate container running the same image, started with
`node dist/workers/ffmpeg.worker.js`. That one process runs **five BullMQ workers**:

| Queue | Concurrency | Work |
|-------|-------------|------|
| `media-processing` | 2 | HLS multi-rendition transcode, proxy, thumbnails, sprite sheet, trim, 3D→GLB conversion, splat processing, antivirus scan |
| `storage-cleanup` | 2 | Retry of orphaned MinIO deletions |
| `webhooks` | 3 | Outgoing signed HTTP deliveries |
| `timeline-export` | 1 | Auto-cut timeline exports |
| `shotgrid` | 2 | ShotGrid events, polling, reconciliation |

Outgoing webhooks leave from the worker, not from the API — the API container never
makes arbitrary outbound HTTP calls.

## Frontend

- **React 19 + Vite 7 + Tailwind**, shadcn-style primitives, TanStack Query for all
  data fetching, Zustand for cross-page state (uploads, auth).
- Single-page app served by nginx, which also proxies `/api` and `/socket.io` — the
  browser only ever talks to one origin. `client_max_body_size 1G`, and DNS is
  re-resolved every 10 s (`resolver 127.0.0.11 valid=10s`) so restarting the backend
  container does not strand nginx on a dead IP.

## Storage model

- PostgreSQL holds all metadata; **MinIO holds every binary** (originals, HLS segments,
  thumbnails, attachments, HDRIs) referenced by object key.
- Read URLs are presigned for **1 hour**, upload URLs for **15 minutes**.
- Details: [MinIO storage](storage-minio.md).

## Single-instance assumptions

Several pieces of state live in the API process memory, not in Redis or PostgreSQL:

| State | Where |
|-------|-------|
| Rate-limit counters | In-memory map, capped at 100 000 keys, swept every 60 s |
| Socket.io rooms | Default in-memory adapter — **no Redis adapter** |
| Presence and live review sessions | In-memory maps |
| Session-validity cache | In-memory, 30 s TTL, 10 000 entries |
| Daily/weekly schedulers | `setInterval` in the API process, **no distributed lock** |

Consequently **run exactly one `backend` replica**. Two replicas would split
Socket.io rooms, double every scheduled sweep and digest, and give each replica its own
rate-limit budget. The `worker` service, by contrast, is stateless and safe to scale:

```bash
docker compose up -d --scale worker=3
```

Only one non-queue use of Redis exists: a pub/sub channel (`review:worker-events`) that
lets the worker tell the API when an HLS rendition or a set of scene markers is ready.
It is explicitly best-effort — a client that misses the push re-reads state from the
API.

## Failure modes

The three backing services fail in three different ways. Know which is which before
you page someone.

| Service down | Effect |
|--------------|--------|
| **MinIO** | The backend **cannot boot**: `ensureBucket()` runs before the listener and an uncaught failure exits the process with code 1. With `restart: always`, the container crash-loops until MinIO answers. An already-running backend keeps serving metadata but fails on any storage operation |
| **Redis** | The backend **boots normally and serves reads**. Anything that enqueues a job (upload finalize, reprocess, trim, USD recompose, timeline export, webhook test) **hangs** rather than erroring: BullMQ retries forever and ioredis queues commands offline. See [Jobs & workers](jobs-and-workers.md#redis-unreachable) |
| **PostgreSQL** | The backend boots and answers `500` on every request that touches the database. Audit entries, event journal writes and session touches are deliberately swallowed, so they are silently lost for the duration |

In all three cases `GET /health` still returns `200`: it is a liveness probe and checks
nothing. The compose healthcheck uses exactly that endpoint, so **a "healthy" backend
container is not evidence that the stack works**. The real probe is
`GET /api/admin/system`, which pings the database, Redis and MinIO — it is admin-only
and has no timeout of its own.

There is also **no graceful shutdown**: nothing listens for `SIGTERM`. A
`docker compose stop` kills in-flight transcodes with their job lock still held; BullMQ
recovers them ~30 s later through the stalled-job mechanism.

## Production notes

A TLS-terminating nginx fronts the compose stack in production
(`docker-compose.prod.yml` + `nginx/nginx.conf`), and is the only exposed service. It
proxies `/api/` and `/socket.io/` to the backend, `/<bucket>/` to MinIO (preserving the
signed `Host`), and everything else to the frontend. Each location sets its own CSP;
the storage path carries `Content-Security-Policy: sandbox; default-src 'none';
frame-ancestors 'none'`, which neutralises any active content served from an uploaded
object.

The backend refuses weak `JWT_SECRET`, `CORS_ORIGIN=*` and default MinIO credentials in
production mode — see [Installation](../getting-started/installation.md#production-deployment).

## Related pages

- [Docker stack](../getting-started/docker-stack.md)
- [Jobs & workers](jobs-and-workers.md)
- [MinIO storage](storage-minio.md)
- [Monitoring & operations](monitoring.md)
- [Backups & restore](backups.md)
- [Security model](security.md)
