# Storage map (MinIO)

> Updated: 2026-08-02

*Admin → Stockage* (`/admin/storage`) answers the question "where does each
file live in the bucket?". The whole instance uses **one S3/MinIO bucket**
(`S3_BUCKET`); the page combines a live scan of that bucket with a static map
of the key conventions.

## Live report

`GET /api/admin/storage` (admin only) walks the entire bucket
(`ListObjectsV2`, paginated) and aggregates objects by key convention:

- **totals** — object count and bytes;
- **per top-level prefix** — originals, derived files, studio libraries,
  avatars, branding, documents, comment attachments, quarantine;
- **derived breakdown** — HLS renditions, thumbnails, converted GLB, video
  proxies, client MP4s, timeline sprites, review references, splat edits;
- **per project** — the weight of `projects/<slug>/…`, cross-referenced with
  the database: rows link to the project admin page, a slug without a matching
  project is flagged as a potential orphan, deleted projects are tagged.

The scan runs on demand (the page caches the result for a few minutes and
offers a *Re-scan* button); on very large buckets it can take a few seconds.

## Key conventions

| File type | Object key | Written by |
|-----------|------------|------------|
| Uploaded original | `projects/{projectSlug}/{parentSegment}/{versionName}/{mediaId}/{filename}` | browser (presigned PUT) |
| HLS renditions | `derived/{mediaId}/hls/master.m3u8` + `{height}p_*.ts` | FFmpeg worker |
| Thumbnail | `derived/{mediaId}/thumbnail.jpg\|webp` | FFmpeg worker |
| Video proxy | `derived/{mediaId}/proxy.mp4` (+ `proxy-trim.mp4`) | FFmpeg worker |
| Client MP4 (burn-ins) | `derived/{mediaId}/client.mp4` | FFmpeg worker |
| Timeline sprite | `derived/{mediaId}/timeline-sprite.jpg` | FFmpeg worker |
| Converted GLB (3D/USD) | `derived/{mediaId}/model.glb` | conversion worker |
| Splat edits | `derived/{mediaId}/splat-mask.bin`, `splat-subset.bin` | splat editor |
| Review reference image | `derived/{mediaId}/reference-{uuid}.{ext}` | 2D review |
| HDRI | `studio/hdris/{uuid}.{exr\|hdr}` | admin HDRI library |
| OCIO config | `studio/ocio/{uuid}.ocio` | admin color management |
| Avatar | `avatars/{userId}.{ext}` | user profile |
| Studio logo | `branding/logo-{timestamp}.{ext}` | admin settings |
| Document (PDF) | `documents/{timestamp}-{name}` | Documents page |
| Comment attachment / voice note | `comments/attachments/{userId}/{timestamp}-{name}` | review threads |
| Quarantined upload | `quarantine/{mediaId}/{originalName}` | ClamAV scan |

Notes:

- The original file is the **source of truth** and is never modified; all
  transformations (transcodes, trims, splat edits) produce derived objects or
  non-destructive metadata.
- Deleting a media purges its original folder and its whole
  `derived/{mediaId}/` prefix; obsolete derived files can also be purged from
  *Maintenance → Jobs* (derived purge).
- The code-side source of truth for these conventions is
  `backend/src/services/StorageService.ts` and the FFmpeg worker.

## Related pages

- [MinIO & files](../infrastructure/storage-minio.md)
- [Content explorer](content-explorer.md)
- [System & maintenance](system-and-maintenance.md)
