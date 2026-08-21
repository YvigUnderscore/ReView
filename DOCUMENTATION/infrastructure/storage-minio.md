# MinIO storage

> Updated: 2026-08-21

All binaries live in MinIO (S3-compatible), referenced from PostgreSQL by object key
(`MediaObject.storageKey` and friends). The API never proxies file bytes.

## Configuration

| Variable | Default | Role |
|----------|---------|------|
| `S3_ENDPOINT` | *(required)* | Endpoint used by the backend and the worker (compose: `http://minio:9000`) |
| `S3_PUBLIC_ENDPOINT` | falls back to `S3_ENDPOINT` | Endpoint used to **sign browser-facing URLs** |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | *(required)* | Credentials. `minioadmin` is rejected in production |
| `S3_BUCKET` | `review` | A single bucket holds everything |
| `S3_REGION` | `us-east-1` | Signing region |
| `S3_FORCE_PATH_STYLE` | `true` | Required by MinIO |

Two S3 clients are built: one against `S3_ENDPOINT` for server-side operations, one
against `S3_PUBLIC_ENDPOINT` for signing. Getting `S3_PUBLIC_ENDPOINT` wrong is the
single most common deployment mistake: uploads and playback break in the browser while
the server-side smoke test passes.

At boot the backend creates the bucket if missing and applies a CORS policy derived
from `CORS_ORIGIN`:

```json
{
  "AllowedHeaders": ["*"],
  "AllowedMethods": ["GET", "HEAD", "PUT"],
  "AllowedOrigins": ["https://review.mystudio.com"],
  "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
  "MaxAgeSeconds": 3600
}
```

Bucket creation is fatal on failure; the CORS step is not (it logs
`[Storage] Configuration CORS ignorée`, and browser uploads then fail with an opaque
CORS error).

## Key layout

Everything lives in a single bucket. Keys follow these conventions
(`{mediaId}` is the numeric `MediaObject` id shown in the version panel and admin):

| Prefix / key | Contents |
|---|---|
| `projects/{projectSlug}/{parent}/{versionName}/{mediaId}/{filename}` | **Originals** as uploaded (video, image, GLB/FBX/OBJ, USD/USDZ archives, PLY/SPZ/SOG splats). `{parent}` is `shots/{sequence}/{shot}` for shot versions or `assets/{asset}` for asset versions. Never modified after upload |
| `derived/{mediaId}/model.glb` | **Converted 3D model** — output of the conversion pipeline (USD via Blender + usd-core, FBX/OBJ/DAE/STL via assimp, glTF packed). This is what the viewer loads; the USD original above stays untouched |
| `derived/{mediaId}/hls/` | HLS playlists and segments (`master.m3u8`, renditions) |
| `derived/{mediaId}/thumbnail.webp` | Media thumbnail |
| `derived/{mediaId}/proxy.mp4`, `proxy-trim.mp4` | Video proxy (and trimmed proxy) |
| `derived/{mediaId}/client.mp4` | Burn-in client derivative, served only through hardened shares |
| `derived/{mediaId}/timeline-sprite.jpg` | Hover-scrub sprite sheet |
| `derived/{mediaId}/splat-mask.bin`, `splat-subset.bin` | Non-destructive splat edit artifacts (bitset mask, subset transform ops) |
| `derived/{mediaId}/reference-*.{ext}` | Review reference images |
| `quarantine/{mediaId}/…` | Objects moved aside by an antivirus detection |
| `comments/attachments/{userId}/…` | Comment attachments (images, voice notes) |
| `studio/hdris/…`, `studio/ocio/…` | Studio-wide HDRIs and OCIO configs |
| `branding/…` | Studio logo and branding assets |

Derived objects are keyed by **media id**, not next to the original's project path.
Renaming a project therefore never orphans derived files.

## Upload lifecycle

Files below 16 MiB take the simple path, larger ones are uploaded as S3 multipart with
16 MiB parts.

```
POST /api/media/upload-url            → 201 { mediaObjectId, storageKey, uploadUrl, namingWarning }
PUT  <uploadUrl>                      → browser writes straight to MinIO
POST /api/media/:id/finalize          → magic bytes, size, quotas, enqueue the job
```

Multipart:

```
POST /api/media/multipart/init            → 201, resumes an interrupted upload if the hash matches
POST /api/media/multipart/:id/parts       → presigned URLs for up to 64 part numbers (1–10000)
POST /api/media/multipart/:id/complete    → assembles the parts
POST /api/media/:id/finalize
POST /api/media/multipart/:id/abort       → cancels and removes the media row
```

An interrupted upload resumes where it left off — the server lists the parts MinIO
already holds, so the client keeps no state. Every upload carries a client-side sha256;
the worker re-hashes the downloaded file and fails the media on mismatch, and identical
content already in storage is **deduplicated** server-side (instant upload, audited as
`MEDIA_DEDUP`).

### Presigned URL lifetimes

| Operation | TTL |
|-----------|-----|
| `PUT` upload (simple) | **15 minutes** |
| `PUT` upload (multipart part) | 1 hour |
| `GET` read | **1 hour** |

Signing is local — it never contacts MinIO. A presign call therefore succeeds even when
MinIO is completely down; the failure surfaces later, in the browser.

The `Content-Type` sent by the client is normalised to a harmless value before signing,
but S3 only signs the `host` header, so it is not binding. The definitive type is set
server-side at finalize, and active content is neutralised anyway by the `sandbox` CSP
that the production nginx puts on the storage path.

## Quotas and limits

| Limit | Setting key | Default | Exceeded → |
|-------|-------------|---------|------------|
| Maximum file size | `max_file_size` | 5 GiB | `400 FILE_TOO_LARGE` |
| Concurrent uploads per user | `max_concurrent_uploads` | 5 | `429 TOO_MANY_UPLOADS` |
| Storage per user | `user.storageLimit`, else `storage_limit_user` | 10 GiB | `403 STORAGE_LIMIT` |
| Storage per project | `Project.storageQuota` (bytes) | **unset = unlimited** | `403 PROJECT_QUOTA` |
| Filename convention (`reject` mode) | per project | — | `400 NAMING_REJECTED` |

Size and project quota are checked twice: once against the **declared** size when the
upload URL is issued, once against the **real** object size at finalize (which sets the
media `FAILED` and deletes the object before answering). The per-user storage limit is
only checked against the declared size, and `ADMIN` accounts are exempt from it.

Project usage is the sum of the sizes of the project's non-deleted media, whatever the
attachment (shot task, asset task or asset). Read it with:

```bash
curl -s -H "Authorization: Bearer $JWT" "$REVIEW/api/projects/3/usage"
```

## Deletion

Deletion is soft in the app (`deletedAt`). Purging — from the admin trash, from the
daily sweep after `trash_retention_days`, or with `DELETE /api/media/:id/purge` —
removes the storage objects. A storage deletion that fails **after** the database
commit is pushed onto the `storage-cleanup` queue and retried 8 times with 15 s
exponential backoff, so a MinIO blip does not silently leak objects.

Two known leaks to be aware of when reconciling:

- the obsolete-derived purge marks `metadata.hlsPurged = true` even when the storage
  delete failed, so those objects are never retried;
- after a video transcode the original is deleted and `metadata.sourceDeleted` is set
  **before** the delete is confirmed; a failed delete leaves an unreferenced original.

Find orphans with the admin storage explorer (`GET /api/admin/storage`) or directly:

```bash
docker compose exec minio mc du local/review
docker compose exec minio mc ls --recursive local/review/derived | head
```

## Splat specifics

Splat originals are **immutable**; edits are stored as compact binary ops and masks
(bitsets) in MinIO plus metadata in PostgreSQL, and replayed by the viewer for every
spectator.

## Failure modes

| Situation | What happens |
|-----------|--------------|
| MinIO down at backend boot | `ensureBucket()` throws before the HTTP listener starts; the process exits 1 and crash-loops under `restart: always` |
| MinIO down while running | Presign still succeeds (local signing). `POST /api/media/:id/finalize` answers `500` and the media stays `UPLOADING`. Worker jobs fail the media with the raw SDK message in `processingError`, retried 3× |
| MinIO **disk full** (`XMinioStorageFull`, HTTP 507) | No dedicated handling — arrives as a generic S3 error and takes the paths above. Uploads look like ordinary processing failures |
| Transient error during a multipart resume | `init` interprets a failed part listing as an expired upload and **deletes the pending media row**; the client must restart the upload |
| Wrong `S3_PUBLIC_ENDPOINT` | Presigned URLs point at an unreachable or wrongly-signed host; the browser fails on `PUT`/`GET` while the server logs nothing |

The AWS SDK's default retry policy (3 attempts, retryable errors only) is the only
retry layer — no application-level retry or circuit breaker exists in the storage
service.

## Operations

```bash
# Health, capacity, and per-prefix usage
docker compose exec minio mc admin info local
docker compose exec minio mc du local/review

# What the backend thinks
curl -s -H "Authorization: Bearer $ADMIN_JWT" "$REVIEW/api/admin/system"
```

`GET /api/admin/system` returns `services: { database, redis, minio }` — the MinIO
probe is a `HeadBucket` on the configured bucket.

- Console on port `9001`, bound to `127.0.0.1` by default. In production
  `docker-compose.prod.yml` removes every host port from MinIO: reach the console over
  an SSH tunnel or a VPN, and the S3 API through nginx at `https://<domain>/<bucket>/`.
- Back up `miniodata` together with `pgdata` — keys in the database must match objects.
  See [Backups & restore](backups.md).

## Related pages

- [Architecture](architecture.md)
- [Docker stack](../getting-started/docker-stack.md)
- [Jobs & workers](jobs-and-workers.md)
- [Backups & restore](backups.md)
- [Storage (admin)](../admin-guide/storage.md)
