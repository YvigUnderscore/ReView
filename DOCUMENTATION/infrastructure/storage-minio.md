# MinIO storage

> Updated: 2026-08-02

All binaries live in MinIO (S3-compatible), referenced from PostgreSQL by object
key (`MediaObject.storageKey` and friends).

## Key layout

Everything lives in a single bucket. Keys follow these conventions
(`{mediaId}` is the numeric `MediaObject` id shown in the version panel and admin):

| Prefix / key | Contents |
|---|---|
| `projects/{projectSlug}/{parent}/{versionName}/{mediaId}/{filename}` | **Originals** as uploaded (video, image, GLB/FBX/OBJ, USD/USDZ archives, PLY/SPZ/SOG splats). `{parent}` is `shots/{sequence}/{shot}` for shot versions or `assets/{asset}` for asset versions. Never modified after upload. |
| `derived/{mediaId}/model.glb` | **Converted 3D model** — output of the conversion pipeline (USD via Blender + usd-core, FBX/OBJ/DAE/STL via assimp, glTF packed). This is what the viewer loads; the USD original above stays untouched. |
| `derived/{mediaId}/hls/` | HLS playlists and segments (`master.m3u8`, renditions). |
| `derived/{mediaId}/thumbnail.webp` | Media thumbnail. |
| `derived/{mediaId}/proxy.mp4`, `proxy-trim.mp4` | Video proxy (and trimmed proxy). |
| `derived/{mediaId}/client.mp4` | Burn-in client derivative, served only through hardened shares. |
| `derived/{mediaId}/timeline-sprite.jpg` | Hover-scrub sprite sheet. |
| `derived/{mediaId}/splat-mask.bin`, `splat-subset.bin` | Non-destructive splat edit artifacts (bitset mask, subset transform ops). |
| `derived/{mediaId}/reference-*.{ext}` | Review reference images. |
| `comments/attachments/{userId}/…` | Comment attachments (images, voice notes). |
| `studio/hdris/…`, `studio/ocio/…` | Studio-wide HDRIs and OCIO configs. |
| `branding/…` | Studio logo and branding assets. |

## Lifecycle

- Originals are uploaded via **presigned PUT URLs** (the browser talks to MinIO
  directly; the API never proxies file bytes).
- The worker writes derived objects (HLS playlists/segments, thumbnails, converted
  GLBs, splat artifacts) under `derived/{mediaId}/`, keyed by media id — not next
  to the original's project path.
- Reads use **presigned GET URLs** with limited lifetime, issued only after RBAC
  checks.
- Deletions are soft in the app; purging from the admin trash removes the storage
  objects.

## Splat specifics

Splat originals are **immutable**; edits are stored as compact binary ops and
masks (bitsets) in MinIO plus metadata in PostgreSQL, and replayed by the viewer.

## Operations

- Console available on port `9001` (credentials from the environment).
- Back up `miniodata` together with `pgdata` — keys in the DB must match objects.

## Related pages

- [Architecture](architecture.md)
- [Docker stack](../getting-started/docker-stack.md)
