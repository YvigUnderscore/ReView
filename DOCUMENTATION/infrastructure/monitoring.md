# Monitoring & operations

> Updated: 2026-08-22

## Health probes

Two questions, two answers. Asking the wrong one is how a backend with a dead connection
pool keeps receiving traffic.

| Endpoint | Question | Touches | Fails when |
|----------|----------|---------|-----------|
| `GET /health`, `GET /health/live` | Is the process alive? | nothing | the process is gone |
| `GET /health/ready` | Can it actually serve? | Postgres, Redis, MinIO | any dependency is unreachable (**503**) |

Both are also mounted under `/api/` (`/api/health`, `/api/health/ready`). That matters in
production: the TLS front only proxies `/api/`, `/socket.io/` and signed `/review/`, so
`GET /health` on the public domain is answered by the SPA — 200 HTML, whatever the API is
doing. **External monitoring must use `https://<domain>/api/health/ready`.**

```bash
curl -s http://localhost:3430/health
```

```json
{ "status": "ok", "version": "2.3.0", "commit": "a1b2c3d4e5f6", "uptimeSec": 91422 }
```

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3430/health/ready   # 200 or 503
curl -s http://localhost:3430/health/ready | jq
```

```json
{
  "status": "ready",
  "version": "2.3.0",
  "cached": false,
  "checks": {
    "database": { "ok": true, "ms": 2 },
    "redis": { "ok": true, "ms": 1 },
    "storage": { "ok": true, "ms": 7 }
  }
}
```

Readiness is bounded on purpose, so that probing cannot become the load that finishes off
a struggling instance: **each check times out at 2 s**, the result is **memoised for 5 s**
(`"cached": true` says you got the memo), and concurrent calls share one execution.

Liveness stays trivial *by design*: restarting the API container because Postgres is down
adds an outage to an outage. That is why the compose healthcheck defaults to `/health`.
An operator who wants the container marked unhealthy when a dependency is missing sets
`HEALTH_PATH=/health/ready` in `.env` — the probe reads its path from that variable. The
`frontend` service has a probe of its own (`wget` on `/index.html`): an nginx that
rejected its configuration no longer counts as running. See
[Containers & configuration](containers-and-configuration.md#health-probes).

`GET /api/admin/system` still exists and reports the same three dependencies plus host
metrics, but it is admin-only and has no timeout of its own; use `/health/ready` for
monitoring and `/api/admin/system` for a human looking at a screen.

## Which version is running

```bash
curl -s http://localhost:3430/api/version
```

```json
{
  "version": "2.3.0",
  "commit": "a1b2c3d4e5f6",
  "builtAt": "2026-08-22T09:30:00.000Z",
  "node": "v22.14.0",
  "source": "https://github.com/YvigUnderscore/ReView"
}
```

Public and unauthenticated on purpose: support cannot diagnose an instance that cannot
name itself, and the AGPL §13 offer only means something if you can tell *which* sources
correspond to what is running. The same values appear in **Admin → System → About this
instance**, in the liveness payload, and as the `review_worker_info` metric.

The version comes from `APP_VERSION` in `.env` — written by `scripts/install.sh` and
rewritten by `scripts/update.sh` at every switch — and falls back to the `package.json`
version baked into the image. `GIT_SHA` and `BUILD_DATE` are optional and injected by the
release workflow.

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

All five queues are exported: `media`, `storage-cleanup`, `webhooks`, `timeline-export`
and `shotgrid`.

### Worker metrics

The worker exposes its own collection point on the compose network — **`worker:9101/metrics`**,
no host port — because Prometheus scraping only the API left the actual work unmeasured:
encode durations, failures per job type, and whether the process exists at all.

- default Node.js process metrics for the worker process (`process_*`, `nodejs_*`) — this
  is what makes "the worker is alive" a fact rather than an inference from queue depth;
- `review_worker_jobs_total{queue,kind,outcome}` — jobs finished, `outcome` being
  `completed` or `failed`;
- `review_worker_job_duration_seconds{queue,kind}` — histogram with buckets up to one hour
  (a multi-rendition HLS encode is not an HTTP request);
- `review_worker_info{version,commit}` — constant 1, so PromQL can answer "which version
  is running", and an update that only half happened becomes visible.

The same `METRICS_TOKEN` applies. Both jobs are declared in `monitoring/prometheus.yml`;
Prometheus distinguishes the two processes by the scrape `job` label, not by metric names.

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

- Prometheus scrapes `backend:3000/metrics` (job `review-backend`) and
  `worker:9101/metrics` (job `review-worker`) every 15 s, config in
  `monitoring/prometheus.yml`. If you set `METRICS_TOKEN`, uncomment the
  `params: { token: ["<your token>"] }` line under **both** jobs.
- Grafana on **`GRAFANA_BIND:GRAFANA_PORT`**, default `127.0.0.1:3431` — loopback only,
  because the dashboard covers the whole instance. Reach it remotely over an SSH tunnel
  or a VPN.
- Set **`GRAFANA_ADMIN_PASSWORD`** in `.env`. It falls back to Grafana's historical
  `admin`, which is a real administrator account; the fallback exists only because
  compose interpolates the whole file even for inactive profiles. Sign-up and anonymous
  access are disabled.
- The Prometheus datasource and the dashboard **ReView — API & jobs** are provisioned from
  `monitoring/grafana/provisioning/`. Eight panels, alerts first: firing alerts, running
  version, requests/s by status, p95 latency, BullMQ depth (all five queues), process RSS
  per job, worker jobs per minute by outcome, worker job p95 duration per queue.
- Both images are **pinned** (`prom/prometheus:v3.5.0`, `grafana/grafana-oss:11.6.1` —
  the dashboard is schemaVersion 39). Override with `PROMETHEUS_VERSION` /
  `GRAFANA_VERSION` in `.env` rather than editing the compose file.

## Alert rules

`monitoring/rules/alerts.yml` holds the rules Prometheus evaluates every 15 s. They exist
so this page stops being a list of queries somebody is supposed to run by hand.

| Alert | Fires when | Severity |
|-------|-----------|----------|
| `ReviewBackendDown` | the API answers no scrape for 2 min | critical |
| `ReviewWorkerDown` | the worker answers no scrape for 5 min | critical |
| `ReviewHttpErrorRatio` | >5 % of responses are 5xx over 10 min | critical |
| `ReviewQueueBacklog` | >20 jobs waiting on a queue for 15 min | warning |
| `ReviewQueueFailures` | failed jobs left in a queue for 10 min | warning |
| `ReviewMediaJobStuck` | a media job active for a full hour | warning |
| `ReviewWorkerJobFailureRate` | >3 job failures in 30 min on one queue | warning |
| `ReviewHttpLatencyHigh` | p95 above 2 s for 15 min | warning |
| `ReviewProcessRestarting` | more than three restarts in an hour | warning |
| `ReviewVersionMismatch` | two versions running at once for 15 min | warning |

Each rule carries a `description` that says what to look at first, so the alert text is
usable at 3 a.m. by somebody who did not write it.

**Mount the rules directory into Prometheus** — the compose service must include:

```yaml
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./monitoring/rules:/etc/prometheus/rules:ro       # ← alert rules
```

`rule_files` uses a glob (`/etc/prometheus/rules/*.yml`) precisely so that a missing mount
degrades to "no alerts" instead of "Prometheus refuses to start".

Without an Alertmanager the rules are still evaluated and visible — in the Prometheus UI,
through the `ALERTS` series, and in the dashboard's first panel — they are simply routed
nowhere. To route them by email, copy `monitoring/alertmanager/alertmanager.yml`, fill in
your SMTP details, uncomment the `alerting:` block in `monitoring/prometheus.yml` and add
the service to the `monitoring` profile (the file's header contains the exact snippet).

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

### Rotation

Every service is capped at **10 MB × 5 files** (`json-file` driver). Docker's default is
unbounded, and on a NAS an active instance fills the system pool until the appliance
itself stops working. Consequence to keep in mind: `docker compose logs --since 24h` may
find nothing on a busy day. Ship the logs elsewhere (`gelf`, `journald`, a sidecar) if
you need real retention — the driver is per service and easy to swap. Ceilings and
rationale: [Containers & configuration](containers-and-configuration.md#resource-limits-and-log-rotation).

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

Most of this table is now an alert rule (see [Alert rules](#alert-rules)); it is kept
because the *meaning* column is what an operator actually needs, and because two rows —
media stuck in `PROCESSING`, requests hanging — have no metric behind them yet.

| Signal | Where | Meaning |
|--------|-------|---------|
| `review_queue_jobs{state="waiting"}` climbing | Prometheus | Worker down, or Redis unreachable from it |
| `review_queue_jobs{state="failed"} > 0` | Prometheus | Check the job dashboard for the error text |
| 5xx ratio | Prometheus | Often the database; check `docker compose logs backend` |
| Backend restarting in a loop | `docker compose ps` | MinIO unreachable at boot, or an invalid environment |
| Media stuck in `PROCESSING` with no error | Admin content explorer | Lost enqueue, or a job that stalled twice. Retry with `POST /api/media/:id/reprocess` |
| Requests hanging with no response | Client side | Redis unreachable: enqueue paths block instead of failing |
| Worker killed mid-transcode, exit code 137 | `docker compose ps -a` | The OOM killer hit `WORKER_MEM_LIMIT` — raise it in `.env` (Blender on a heavy USD stage is the usual suspect) |

## Related pages

- [Containers & configuration](containers-and-configuration.md) — env, limits, pins, probes
- [Jobs & workers](jobs-and-workers.md) — queue settings and failure modes in detail
- [Architecture](architecture.md)
- [Backups & restore](backups.md)
- [Security model](security.md)
- [System & maintenance (admin)](../admin-guide/system-and-maintenance.md)
