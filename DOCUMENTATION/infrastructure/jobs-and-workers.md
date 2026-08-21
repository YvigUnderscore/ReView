# Jobs & workers

> Updated: 2026-08-21

Long-running work is queued in **BullMQ** (Redis) and processed by the dedicated
`worker` container — the API never blocks on media processing.

## Queues

One worker process (`node dist/workers/ffmpeg.worker.js`) runs five BullMQ workers.
Job options are set once per queue in `backend/src/services/JobService.ts`.

| Queue name | Concurrency | Attempts | Backoff | Kept on complete / fail |
|------------|-------------|----------|---------|--------------------------|
| `media-processing` | 2 | 3 | exponential, 5 s base | 100 / 500 |
| `storage-cleanup` | 2 | 8 | exponential, 15 s base | 100 / 1000 |
| `webhooks` | 3 | 5 | exponential, 10 s base | 200 / 500 |
| `timeline-export` | 1 | 2 | exponential, 10 s base | 50 / 100 |
| `shotgrid` | 2 | 2 | exponential, 15 s base | 200 / 500 |

"Attempts" is the **total** number of tries, not the number of retries: a
`media-processing` job runs at most three times. No per-job timeout is configured on
any queue; the only hard time limit in the pipeline is
`MODEL_CONVERT_TIMEOUT_MS` (default 15 min), which kills a stuck external 3D converter.

`timeline-export` uses a deterministic `jobId` (`timeline-<id>`), so asking twice for
the same export while one is pending is a no-op rather than a duplicate.

## Job types on `media-processing`

| `kind` | Trigger | Output |
|--------|---------|--------|
| `transcode` | Video upload finalized | Proxy MP4, multi-rendition HLS ladder, thumbnail, timeline sprite sheet, client burn-in derivative |
| `trim` | Trim requested in review (pre-publish) | Re-cut proxy |
| `thumbnail` | Image upload finalized, or a manual request | Card & preview images |
| `convert3d` | Non-GLB 3D upload | `derived/{mediaId}/model.glb` via Blender (USD), `guc` or assimp |
| `scan` | Any upload when `CLAMAV_HOST` is set | Antivirus verdict |

Splat media are served from their original file; their non-destructive edits are
written by the API, not by a job.

## Lifecycle

```
UPLOADING ──finalize──► PROCESSING ──job ok──► READY
                             └──job error──► FAILED
```

- The status is written to `MediaObject.status` and pushed live to the UI over
  Socket.io.
- A failure stores the error message on `MediaObject.metadata.processingError`
  (truncated to 500 characters) and sets `FAILED`.
- `trim` and `scan` failures deliberately **do not** mark the media `FAILED`: a failed
  trim still leaves a playable proxy, and an unreachable clamd must never fail a file
  that was never found to be infected. Both are still retried by BullMQ.

Two behaviours worth knowing when reading a status:

- `markFailed` runs on **every** attempt, not only the last. A media can show `FAILED`
  after attempt 1 and flip back to `READY` on attempt 2.
- `processingError` is only cleared on the `convert3d` success path. A video that
  failed once and then succeeded keeps a stale error string next to `status: READY`.

## Retrying

From the review page, or:

```bash
curl -s -X POST -H "Authorization: Bearer $JWT" \
  "$REVIEW/api/media/128/reprocess"
```

```json
{ "media": { "id": 128, "status": "PROCESSING", "…": "…" }, "requeued": true }
```

`requeued` is `false` when there is nothing to reconvert (a native GLB, for instance);
the media is simply set back to `READY`. It refuses a media still in `UPLOADING`
(`400 NOT_FINALIZED`) and a published one
(publish lock, `403 PUBLISHED_LOCKED`), sets the media back to `PROCESSING` and audits
`MEDIA_REPROCESS`. It does not clear the previous `processingError`, so the old message
stays visible while the retry runs.

At the job level (admin only):

```bash
curl -s -X POST -H "Authorization: Bearer $ADMIN_JWT" \
  "$REVIEW/api/admin/jobs/media/4821/retry"

curl -s -X POST -H "Authorization: Bearer $ADMIN_JWT" \
  "$REVIEW/api/admin/jobs/webhooks/clean-failed"
```

`queue` is restricted to `media`, `storage-cleanup` and `webhooks`. Only a failed job
can be retried (`400` otherwise). **`timeline-export` and `shotgrid` are not exposed in
the admin dashboard** — their failures are visible only in the worker logs.

## Failure modes

### Redis unreachable

The connection is built from `REDIS_URL` with `maxRetriesPerRequest: null`; BullMQ adds
a retry strategy that never gives up (1 s → 20 s, forever), and ioredis queues commands
offline by default. The practical consequences:

- The **API still boots and serves** — nothing in the boot path awaits Redis.
- Any request that enqueues a job (`POST /api/media/:id/finalize`,
  `/reprocess`, `/trim`, USD recompose, timeline export, webhook test) **hangs** instead
  of returning an error. No route sets a request timeout, so the client sees a stalled
  connection, not a `500`.
- `finalize` writes `status: PROCESSING` **before** enqueuing. A lost enqueue therefore
  strands the media in `PROCESSING` permanently — there is no reconciliation sweep for
  that state. Re-run it with `POST /api/media/:id/reprocess` once Redis is back.
- `GET /api/admin/system` pings Redis but has no timeout of its own, so it can hang too.
- BullMQ connection errors are printed by the library on **stderr via `console.error`**,
  not through pino: they have no request id and no JSON structure. Look for raw
  `ECONNREFUSED` lines in `docker compose logs backend`.
- The `review_queue_jobs` gauges stop updating (the refresher logs
  `[metrics] files illisibles` only if the call actually rejects).

Two things deliberately survive a Redis outage: trash purge enqueues its storage
cleanup with a `.catch` that logs *"orphelins non retentés"*, and the ShotGrid webhook
receiver answers `202 { "accepted": true }` before enqueuing, so ShotGrid never sees a
failed delivery.

Rate limiting, idempotency records, presence and live sessions do **not** use Redis and
are unaffected.

### The worker dies mid-transcode

No stalled-job settings are configured, so the BullMQ defaults apply:

| Setting | Value |
|---------|-------|
| `lockDuration` | 30 s (renewed every 15 s) |
| `stalledInterval` | 30 s |
| `maxStalledCount` | 1 |

Sequence of events when the container is killed during a transcode:

1. The media row is already `PROCESSING`.
2. The lock expires ~30 s after the last renewal; the next stalled scan moves the job
   back to `wait`.
3. A worker picks it up and **re-runs the handler from the top** — re-download,
   re-transcode. There is no per-step checkpoint.
4. If it stalls a **second** time, BullMQ fails the job. That path does not go through
   the application's error handler, so the media stays at `PROCESSING` with **no**
   `processingError` — indistinguishable from "still working". Watch for medias stuck
   in `PROCESSING` with an empty error field.

Two side effects of an interrupted transcode:

- HLS renditions are recorded incrementally, so a crash after the first rendition can
  leave `metadata.hls = { renditions: [...], building: true }` with `status: READY`
  and the `building` flag never clearing. A reprocess rebuilds the whole ladder.
- The temp directory (`review-*` in the container's `tmpdir`, holding the full source
  download, the proxy and the HLS ladder) is only removed by a `finally` block. On
  `SIGKILL` it is orphaned, and nothing sweeps `tmpdir` on boot. Recreating the
  container is the simplest cleanup.

Because there is no `SIGTERM` handler, this is the **normal** path for every
`docker compose stop` or `restart` during processing, not an exceptional one. Drain the
queue before restarting the worker if you can.

### MinIO unreachable or full

- The worker's downloads and uploads are unprotected: any S3 error propagates, the
  media is marked `FAILED` with the raw SDK message in `processingError`, and BullMQ
  retries up to 3 times with 5 s exponential backoff.
- A MinIO **disk full** condition (`XMinioStorageFull`, HTTP 507) has no dedicated
  handling — it arrives as a generic SDK error and takes the path above, so it looks
  like any other processing failure. Check `docker compose exec minio mc admin info local`
  before assuming a codec problem.
- Some steps are best-effort and log-and-continue instead of failing the media: the
  burn-in logo download, the slate/client derivative, the timeline sprite, and the
  deletion of the original after transcode. The last one is worth noting — it marks
  `metadata.sourceDeleted = true` before deleting, so a failed delete leaves an orphan
  original that is no longer referenced.
- Finalize-time storage errors are **not** caught: `POST /api/media/:id/finalize`
  answers `500` and the media stays in `UPLOADING`.

See [MinIO storage](storage-minio.md#failure-modes) for the full picture.

## Scheduled work

All of these run in the **API** process, from plain timers, with no distributed lock:

| Task | Schedule | What it does |
|------|----------|--------------|
| Maintenance sweep | 60 s after boot, then every 24 h | Trash purge, obsolete-derived purge, event-journal purge, idempotency-key purge |
| Daily digest | `DIGEST_HOUR` local time (default 07:00), then every 24 h | Digest mail to users who opted in |
| Weekly report | Next Monday at `DIGEST_HOUR`, then weekly | Production report to supervisors and admins |
| Queue gauges | Every 15 s | Refreshes `review_queue_jobs` |

The maintenance sweep is anchored to the **process start**, not to a wall-clock time:
restarting the backend at 15:00 moves the sweep to 15:01 every day. A throw in one step
aborts the remaining ones for that day (logged as
`[Trash] échec du balayage de purge`).

ShotGrid polling and nightly reconciliation are different: they are BullMQ repeatable
jobs, live in the **worker**, and are re-declared on every worker boot, with a catch-up
reconciliation staggered 10 s + 15 s per connection.

## Retention

| Data | Retention | Where it is set |
|------|-----------|-----------------|
| Trash (media, versions, shots, sequences, assets, projects) | `trash_retention_days`, default **30 days**, `0` disables | Studio setting |
| Obsolete derived files (HLS + sprite beyond the last N versions) | Off by default; `derived_purge` = `{ enabled, keepVersions }`, `keepVersions` default 3, clamped 1–100 | Studio setting |
| v1 event journal | **30 days** | Hard-coded constant |
| Idempotency keys | **24 hours** | Hard-coded constant |
| Sessions | **never purged** — validity is enforced at read time, the table grows without bound | — |

## Observing the queues

```bash
docker compose logs -f worker
docker compose logs -f worker | grep '✗'          # failures only
curl -s http://localhost:3430/metrics | grep review_queue_jobs
```

```
review_queue_jobs{queue="media",state="waiting"} 0
review_queue_jobs{queue="media",state="active"} 1
review_queue_jobs{queue="media",state="failed"} 0
review_queue_jobs{queue="media",state="delayed"} 0
```

Only `media`, `storage-cleanup` and `webhooks` are exported as gauges. Log prefixes:
`[ffmpeg.worker]`, `[storageCleanup.worker]`, `[webhook.worker]`,
`[timelineExport.worker]`, `[shotgrid.worker]`. A worker that logs
`[ffmpeg.worker] démarré.` has started its event loop — that line is printed before any
Redis round-trip, so it is **not** proof that Redis is reachable.

*Admin → Maintenance → Jobs* shows the same three queues with counters, running and
waiting jobs, failed jobs with their error, one-click retry and purge-failed.

## Scaling

The worker is stateless: run several replicas against the same Redis to increase
throughput. FFmpeg is CPU-bound at concurrency 2 per process — size the containers
accordingly, or set `VIDEO_ENCODER=h264_nvenc` to move encoding onto an NVIDIA GPU
(see [Monitoring & operations](monitoring.md#gpu-transcoding-optional-nvenc)).

```bash
docker compose up -d --scale worker=3
```

Do **not** scale the `backend` service — see
[Architecture](architecture.md#single-instance-assumptions).

## Related pages

- [Media processing (user guide)](../user-guide/media-processing.md)
- [Architecture](architecture.md)
- [MinIO storage](storage-minio.md)
- [Monitoring & operations](monitoring.md)
