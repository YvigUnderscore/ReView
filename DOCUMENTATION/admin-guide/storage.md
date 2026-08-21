# Storage map (MinIO)

> Updated: 2026-08-21

*Admin → Content → Storage* (`/admin/storage`) answers "where does each file live in
the bucket, and what is taking up the space?". The whole instance uses **one S3/MinIO
bucket** (`S3_BUCKET`, default `review`); the page combines a live scan of that bucket
with a static map of the key conventions.

## Live report

`GET /api/admin/storage` (**`ADMIN` only**) walks the **entire bucket** with
`ListObjectsV2`, following continuation tokens, and aggregates objects by key
convention:

- **totals** — object count and bytes;
- **per top-level category** — `originals`, `derived`, `studio`, `avatars`,
  `branding`, `comments`, `quarantine`, `other`;
- **derived breakdown** — `hls`, `thumbnails`, `glb`, `proxies`, `client`, `sprites`,
  `references`, `splat-edits`, `other`;
- **studio breakdown** — `hdris`, `ocio`;
- **per project** — the weight of `projects/<slug>/…`, cross-referenced with the
  database: rows link to the project admin page, a slug with **no matching project is
  flagged as a potential orphan**, and projects sitting in the trash are tagged as
  deleted. Sorted by bytes, heaviest first.

There is **no server-side cache**: every call re-scans the bucket in full and holds
the listing in memory. The page's *Re-scan* button forces a refetch; otherwise the
browser reuses the previous result for 5 minutes. On a large bucket the scan takes
seconds and costs a full listing — do not put it on a monitoring cron.

## Key conventions

| File type | Object key | Written by |
|-----------|------------|------------|
| Uploaded original | `projects/{projectSlug}/{parentSegment}/{versionName}/{mediaId}/{filename}` | browser (presigned PUT) |
| HLS | `derived/{mediaId}/hls/master.m3u8`, `{height}p.m3u8`, `{height}p_NNN.ts` | FFmpeg worker |
| Thumbnail | `derived/{mediaId}/thumbnail.jpg` (worker) or `.png`/`.webp` (client-supplied) | FFmpeg worker / upload |
| Video proxy | `derived/{mediaId}/proxy.mp4` (+ `proxy-trim.mp4`) | FFmpeg worker |
| Client MP4 (slate + burn-ins) | `derived/{mediaId}/client.mp4` | FFmpeg worker |
| Timeline sprite | `derived/{mediaId}/timeline-sprite.jpg` | FFmpeg worker |
| Converted GLB (3D/USD) | `derived/{mediaId}/model.glb` | conversion worker |
| Splat edits | `derived/{mediaId}/splat-mask.bin`, `splat-subset.bin` | splat editor |
| Review reference image | `derived/{mediaId}/reference-{uuid}.{ext}` | 2D review |
| Timeline export | `derived/timeline/{timelineId}/master.mp4` | timeline export |
| HDRI | `studio/hdris/{uuid}.{exr\|hdr}` | admin HDRI library |
| OCIO config | `studio/ocio/{uuid}.ocio` | admin colour management |
| Avatar | `avatars/{userId}.{png\|jpg\|webp}` | user profile |
| Branding | `branding/logo-{timestamp}.{ext}`, `login-bg-{timestamp}.{ext}`, `sso-{timestamp}.{ext}` | admin (Delivery, Login page, Identity) |
| Entity thumbnail | `entity-thumbs/{sequence\|shot\|asset}/{id}.{ext}` | sequence/shot/asset thumbnail |
| Comment attachment / voice note | `comments/attachments/{userId}/{timestamp}-{name}` | review threads |
| ShotGrid note attachment | `comments/attachments/shotgrid/{commentId}/{sgId}-{name}` | ShotGrid sync |
| Quarantined upload | `quarantine/{mediaId}/{originalName}` | ClamAV scan |

Two prefixes are not classified by the report and land under `other`:
`entity-thumbs/…` and `derived/timeline/…`. If the *other* bucket in the report is
unexpectedly large, those are the first things to look for.

Notes:

- The **original file is the source of truth and is never modified.** Every
  transformation — transcodes, trims, splat edits, USD overrides — produces derived
  objects or non-destructive metadata.
- Deleting a media purges its original folder and its whole `derived/{mediaId}/`
  prefix.
- The code-side source of truth is `backend/src/services/StorageService.ts` and the
  FFmpeg worker.

## Presigned URLs and endpoints

Media is served through short-lived presigned MinIO URLs, **except HLS**, which is
proxied through the API (`GET /api/media/:id/hls/:file`) and therefore goes through
the normal authentication and project-access checks.

| Operation | Default lifetime |
|-----------|-----------------|
| Upload (`PUT`), including avatars, branding, comment attachments | **15 minutes** |
| Read (`GET`), including media, thumbnails, logos, client shares | **1 hour** |
| Multipart part URLs | 1 hour |

Two endpoints are configured, and mixing them up is the classic production failure:

- `S3_ENDPOINT` — reachable **from the server and the worker**; used for every
  server-side operation.
- `S3_PUBLIC_ENDPOINT` — the host that **signs presigned URLs**, i.e. the one browsers
  will contact. If it is unset it falls back to `S3_ENDPOINT`, which works in Docker
  and breaks the moment a browser outside the compose network follows a URL pointing
  at an internal hostname. It must also match the scheme users reach the app with:
  an `http://` public endpoint behind an HTTPS front end produces mixed-content
  failures, not a helpful error.

Other relevant variables: `S3_BUCKET` (default `review`), `S3_REGION` (default
`us-east-1`), `S3_FORCE_PATH_STYLE` (default `true`), `S3_ACCESS_KEY` /
`S3_SECRET_KEY` (required — the server refuses to start in production if they are
still `minioadmin`), and `CORS_ORIGIN`, which drives the bucket CORS rule allowing
`GET`, `HEAD` and `PUT` from the app origin. A browser upload that fails immediately
with a CORS error is almost always `CORS_ORIGIN` not matching the real front-end URL.

## Derived files purge

Configured in *Admin → Maintenance → Jobs* (`GET`/`PUT /api/admin/derived-purge`,
`POST /api/admin/derived-purge/run`, `ADMIN` only). See
[System & maintenance](system-and-maintenance.md#derived-files-purge) for the full
description; in storage terms it deletes the `derived/{mediaId}/hls/` prefix and the
timeline sprite of video media belonging to versions older than the last *N* per task
or asset, while keeping `proxy.mp4` and the thumbnail.

---

## Use case: reclaiming space when the bucket fills up

*The volume is at 85 % and nobody wants to delete a show.*

1. **Measure before acting.** Open *Admin → Content → Storage* and read the split
   between `originals` and `derived`. The remedy is completely different:
   - `derived` dominant → renditions and sprites; recoverable and regenerable.
   - `originals` dominant → source media; only real deletion or archiving helps.
2. **Look for orphans.** Any project row flagged as having no matching project is a
   slug in the bucket with nothing in the database — usually the residue of a purge
   that failed halfway. Those bytes belong to nobody and can be removed with the MinIO
   client after you have confirmed the slug against
   *Admin → Content → Projects* and the trash.
3. **Check `quarantine/`.** Infected uploads are kept, not deleted. If the studio has
   been running for a year, this can be a surprising amount, and none of it is needed
   once the incident is closed.
4. **Enable the derived purge** with `keepVersions` at 3 to 5. This is the highest
   yield, lowest risk move: old versions lose their HLS ladder and hover sprite but
   stay watchable at proxy quality, and nothing about the original is touched. Run it
   once by hand (*Run now*) and re-scan to measure the gain.
5. **Trim the ladder** so it stops growing: `maxHeight` at 1080 if nobody reviews in
   4K. See [Transcoding](transcoding.md#use-case-cutting-encoding-cost-on-a-delivery-only-studio).
6. **Only then** consider the trash. Emptying it is irreversible, and the daily sweep
   is already purging anything older than `trash_retention_days` on its own.

## Use case: proving where a specific file went

*A supervisor insists a version "disappeared".*

1. *Admin → Content → Versions*, filter by project and name — the version row links to
   the review page of its first media, and shows the publication badge and media
   count. If the row exists with zero media, the upload never finalised.
2. If it is not there, look in *Admin → Maintenance → Trash* (projects) and in the
   project's own trash (`GET /api/projects/:projectId/trash`, global manager role),
   which lists deleted sequences, shots, assets, versions and media.
3. If it is in neither, check the audit log (*Maintenance → Audit*) for
   `VERSION_DELETE`, `VERSION_PURGE`, `MEDIA_DELETE`, `MEDIA_PURGE` or
   `PROJECT_PURGE` — every one of those records the author and the timestamp.
4. If the audit shows nothing and the deletion date would be more than
   `trash_retention_days` ago, it was the **automatic sweep**: soft-deleted items are
   purged without an audit entry and without a confirmation. That is the single most
   common answer to "it disappeared on its own".
5. `MEDIA_QUARANTINED` in the audit means ClamAV took it: the bytes are under
   `quarantine/{mediaId}/`, and the media is `FAILED`, not deleted.

## Related pages

- [MinIO & files](../infrastructure/storage-minio.md)
- [System & maintenance](system-and-maintenance.md)
- [Transcoding](transcoding.md)
- [Content explorer](content-explorer.md)
