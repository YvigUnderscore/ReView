# Monitoring & operations

> Updated: 2026-07-19

## Prometheus metrics

The backend exposes **`GET /metrics`** (Prometheus text format):

- default Node.js process metrics (`process_*`, `nodejs_*`);
- `review_http_request_duration_seconds` — HTTP latency histogram labelled by
  method / normalized route (`:id`, `:token`) / status;
- `review_queue_jobs{queue,state}` — BullMQ depth (waiting/active/failed/delayed),
  refreshed every 15 s.

Access: set `METRICS_TOKEN` in the backend environment and scrape with
`?token=<value>` (or `Authorization: Bearer`). Without a token the endpoint is
open — keep it internal (the nginx frontend does not proxy `/metrics`).

## Bundled Prometheus + Grafana (optional)

```bash
docker compose --profile monitoring up -d
```

- Prometheus scrapes `backend:3000/metrics` (config in `monitoring/prometheus.yml`);
- Grafana on **:3431** (first login `admin`/`admin`), datasource and a base
  dashboard **ReView — API & jobs** (requests/s, p95 latency, queue depth, RSS)
  are provisioned from `monitoring/grafana/provisioning/`.

## Job dashboard (in-app)

*Admin → Maintenance → Jobs* shows each BullMQ queue (media processing, storage
cleanup, webhooks): counters, running/waiting jobs, failed jobs with their error,
one-click **retry** and **purge failed**. The same section hosts the
[derived-files purge](#derived-files-purge).

## Derived-files purge

*Admin → Maintenance → Jobs → « Purge des dérivés obsolètes »* : when enabled,
versions beyond the latest N of each task/asset lose their HLS renditions and
timeline sprite (proxy + thumbnail stay, playback falls back to proxy quality).
Runs daily with the trash sweep, or on demand via the button.

## Antivirus (optional, ClamAV)

```bash
docker compose --profile antivirus up -d            # clamd service (first start
                                                    # downloads the virus DB)
CLAMAV_HOST=clamav docker compose up -d backend worker
```

Every upload is scanned in the worker before processing (INSTREAM). Detections
move the object to `quarantine/<mediaId>/…`, mark the media FAILED and audit
`MEDIA_QUARANTINED`. Media served as-is (native GLB, splats) get a dedicated
async `scan` job right after finalize. If clamd is unreachable the job retries —
a file is never failed without an actual detection.

## GPU transcoding (optional, NVENC)

Set `VIDEO_ENCODER=h264_nvenc` on the worker (requires an NVIDIA GPU exposed to
the container, e.g. compose `deploy.resources.reservations.devices`). Presets are
mapped from the x264 ladder; if NVENC fails at runtime the worker automatically
falls back to libx264 for that encode.

## Resumable uploads & integrity

Files ≥ 16 MB upload as S3 multipart parts; an interrupted upload resumes where
it left off (the server lists already-received parts — no client state). Every
upload carries a client-side sha256: the worker re-hashes the downloaded file and
fails the media on mismatch; identical content already in storage is
**deduplicated** server-side (instant upload, `MEDIA_DEDUP` audit).
