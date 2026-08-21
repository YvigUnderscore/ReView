# Monitoring & operations

> Updated: 2026-08-21

## What "healthy" does and does not mean

```bash
curl -s http://localhost:3430/health
```

```json
{ "status": "ok" }
```

`GET /health` is a **liveness probe only**: it touches neither the database, nor Redis,
nor MinIO. The compose healthcheck for the `backend` service calls exactly this
endpoint, and `worker`, `frontend` and the production `nginx` all gate on it. A green
`docker compose ps` therefore proves the process is up — nothing more.

The real dependency probe is admin-only:

```bash
curl -s -H "Authorization: Bearer $ADMIN_JWT" "$REVIEW/api/admin/system"
```

```json
{
  "services": { "database": true, "redis": true, "minio": true },
  "…": "…"
}
```

It runs `SELECT 1`, a Redis `PING` and a MinIO `HeadBucket`, each falling back to
`false`. Note it has no timeout of its own: with Redis unreachable this call can hang
rather than report `redis: false`. Alert on the metrics below, not on this endpoint.

## Prometheus metrics

The backend exposes **`GET /metrics`** (Prometheus text format):

- default Node.js process metrics (`process_*`, `nodejs_*`);
- `review_http_request_duration_seconds` — HTTP latency histogram labelled by
  `method` / normalized `route` / `status`, with buckets
  0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10 s;
- `review_queue_jobs{queue,state}` — BullMQ depth (`waiting`, `active`, `failed`,
  `delayed`), refreshed every 15 s.

```bash
curl -s "http://localhost:3430/metrics?token=$METRICS_TOKEN" | grep review_
```

```
review_http_request_duration_seconds_count{method="GET",route="/api/media/:id",status="200"} 1284
review_queue_jobs{queue="media",state="waiting"} 0
review_queue_jobs{queue="media",state="active"} 1
review_queue_jobs{queue="storage-cleanup",state="failed"} 0
review_queue_jobs{queue="webhooks",state="delayed"} 2
```

Only three of the five queues are exported: `media`, `storage-cleanup` and `webhooks`.
`timeline-export` and `shotgrid` have no gauge and no admin dashboard entry.

The `route` label is normalised (`/1234` → `/:id`, long hex tokens → `/:token`) and its
cardinality is bounded: a route enters the catalogue only on a response below `400`, at
most **300** distinct routes are tracked, and everything else is aggregated under
`/other`. That is deliberate — the middleware sits in front of the rate limiter and
sees every URL, so an unbounded label would let anyone grow the registry until the
process runs out of memory.

Access: set `METRICS_TOKEN` in the backend environment and scrape with `?token=<value>`
or `Authorization: Bearer <value>`; a wrong value returns an empty `401`. Without a
token the endpoint is **open** — keep it internal. The frontend nginx does not proxy
`/metrics`, and the endpoint is not rate-limited.

### Useful queries

```promql
# request rate by status
sum by (status) (rate(review_http_request_duration_seconds_count[5m]))

# p95 latency
histogram_quantile(0.95, sum by (le) (rate(review_http_request_duration_seconds_bucket[5m])))

# error ratio
sum(rate(review_http_request_duration_seconds_count{status=~"5.."}[5m]))
  / sum(rate(review_http_request_duration_seconds_count[5m]))

# queue backing up — the first thing to alert on
review_queue_jobs{state="waiting"} > 20
review_queue_jobs{state="failed"} > 0
```

A `waiting` count that grows while `active` stays at 0 means the worker is not
consuming: either the container is down, or Redis is unreachable from it.

## Bundled Prometheus + Grafana (optional)

```bash
docker compose --profile monitoring up -d
```

- Prometheus scrapes `backend:3000/metrics` every 15 s (job `review-backend`, config in
  `monitoring/prometheus.yml`). If you set `METRICS_TOKEN`, uncomment the
  `params: { token: ["<your token>"] }` line there.
- Grafana on **`GRAFANA_BIND:GRAFANA_PORT`**, default `127.0.0.1:3431` — loopback only,
  because the dashboard covers the whole instance. Reach it remotely over an SSH tunnel
  or a VPN.
- Set **`GRAFANA_ADMIN_PASSWORD`** in `.env`. It falls back to Grafana's historical
  `admin`, which is a real administrator account; the fallback exists only because
  compose interpolates the whole file even for inactive profiles. Sign-up and anonymous
  access are disabled.
- The Prometheus datasource and the dashboard **ReView — API & jobs** (requests/s by
  status, p95 latency, BullMQ depth, backend RSS) are provisioned from
  `monitoring/grafana/provisioning/`.

## Logs

Logs are pino JSON on stdout, with a request id correlated across the lines of one
request.

```bash
docker compose logs -f backend
docker compose logs -f worker
docker compose logs --since 1h backend | grep '"level":50'      # errors
```

`LOG_LEVEL` accepts `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`;
without it the level is derived from `NODE_ENV`. Secrets are redacted from log objects
(`password`, `secret`, `apiKey`, `accessToken`, including one and two levels of
nesting) and replaced with `[Redacted]`.

Two things escape pino and are worth knowing when reading logs:

- environment validation failures at boot are written straight to stderr, before the
  logger exists;
- **BullMQ connection errors** are printed by the library through `console.error` — raw,
  unstructured, no request id. Redis trouble looks like bare `ECONNREFUSED` lines.

Worker log prefixes: `[ffmpeg.worker]`, `[storageCleanup.worker]`, `[webhook.worker]`,
`[timelineExport.worker]`, `[shotgrid.worker]`. Successes are `✓`, failures `✗`.

## Job dashboard (in-app)

*Admin → Maintenance → Jobs* shows the BullMQ queues `media`, `storage-cleanup` and
`webhooks`: counters, running/waiting jobs, failed jobs with their error, one-click
**retry** and **purge failed**. Equivalent API calls:

```bash
curl -s -H "Authorization: Bearer $ADMIN_JWT" "$REVIEW/api/admin/jobs"
curl -s -X POST -H "Authorization: Bearer $ADMIN_JWT" "$REVIEW/api/admin/jobs/media/4821/retry"
curl -s -X POST -H "Authorization: Bearer $ADMIN_JWT" "$REVIEW/api/admin/jobs/media/clean-failed"
```

Retry refuses anything that is not a failed job (`400`), and both actions are audited
(`JOB_RETRY`, `JOBS_CLEAN_FAILED`). The same section hosts the
[derived-files purge](#derived-files-purge).

## Derived-files purge

*Admin → Maintenance → Jobs → "Purge des dérivés obsolètes"*: when enabled, versions
beyond the latest N of each task/asset lose their HLS renditions and timeline sprite
(proxy + thumbnail stay, playback falls back to proxy quality). Off by default; `N`
(`keepVersions`) defaults to 3 and is clamped to 1–100. Runs daily with the trash sweep,
or on demand via the button (`POST /api/admin/derived-purge/run`).

Caveat when reconciling storage: a media whose HLS delete failed is still recorded as
purged, so those objects are never retried.

## Scheduled maintenance

| Task | When | Notes |
|------|------|-------|
| Trash purge + derived purge + event/idempotency purge | 60 s after backend boot, then every 24 h | Anchored to process start, not to a wall-clock hour |
| Daily digest | `DIGEST_HOUR` local time, default 07:00 | Container `TZ` is `Europe/Paris` in the compose file |
| Weekly report | Next Monday at `DIGEST_HOUR` | Never fires on the day it is scheduled |
| ShotGrid polling / nightly reconciliation | BullMQ repeatables in the worker | Re-declared at every worker boot |

All of the first three run in the **API** process with no distributed lock — another
reason to keep a single `backend` replica.

## Antivirus (optional, ClamAV)

```bash
docker compose --profile antivirus up -d            # clamd service (first start
                                                    # downloads the virus DB)
CLAMAV_HOST=clamav docker compose up -d backend worker
```

Every upload is scanned in the worker before processing (INSTREAM). Detections move the
object to `quarantine/{mediaId}/…`, mark the media `FAILED` and audit
`MEDIA_QUARANTINED`. Media served as-is (native GLB, splats) get a dedicated async
`scan` job right after finalize. If clamd is unreachable the job retries and the media
is **not** failed — a file is never failed without an actual detection. The clamd
healthcheck has a 180 s `start_period` because the first database download is slow.

## GPU transcoding (optional, NVENC)

Set `VIDEO_ENCODER=h264_nvenc` on the worker (requires an NVIDIA GPU exposed to the
container, e.g. compose `deploy.resources.reservations.devices`). Presets are mapped
from the x264 ladder (`fast` → `p4`, `medium` → `p5`, `slow` → `p6`…); if NVENC fails
at runtime the worker automatically falls back to libx264 for that encode and logs
`[ffmpeg.worker] h264_nvenc indisponible — repli libx264`. Grep for that line to tell
"the GPU is being used" from "the GPU was requested". The variable is validated as an
enum, so a typo stops the worker at boot rather than silently disabling acceleration.

## Resumable uploads & integrity

Files ≥ 16 MiB upload as S3 multipart parts; an interrupted upload resumes where it left
off (the server lists already-received parts — no client state). Every upload carries a
client-side sha256: the worker re-hashes the downloaded file and fails the media on
mismatch; identical content already in storage is **deduplicated** server-side (instant
upload, `MEDIA_DEDUP` audit).

## What to watch

| Signal | Where | Meaning |
|--------|-------|---------|
| `review_queue_jobs{state="waiting"}` climbing | Prometheus | Worker down, or Redis unreachable from it |
| `review_queue_jobs{state="failed"} > 0` | Prometheus | Check the job dashboard for the error text |
| 5xx ratio | Prometheus | Often the database; check `docker compose logs backend` |
| Backend restarting in a loop | `docker compose ps` | MinIO unreachable at boot, or an invalid environment |
| Media stuck in `PROCESSING` with no error | Admin content explorer | Lost enqueue, or a job that stalled twice. Retry with `POST /api/media/:id/reprocess` |
| Requests hanging with no response | Client side | Redis unreachable: enqueue paths block instead of failing |

## Related pages

- [Jobs & workers](jobs-and-workers.md) — queue settings and failure modes in detail
- [Architecture](architecture.md)
- [Backups & restore](backups.md)
- [Security model](security.md)
- [System & maintenance (admin)](../admin-guide/system-and-maintenance.md)
