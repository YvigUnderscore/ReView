# Upload & publishing

> Updated: 2026-07-18

## Uploading media

Media are uploaded on a **version** (of a task or asset). Supported kinds:

| Kind | Formats (typical) | Processing |
|------|-------------------|-----------|
| Video | mp4, mov… | HLS multi-rendition transcode + thumbnails |
| Image | png, jpg, exr-derived stills… | Thumbnails |
| 3D model | glb, gltf, and formats converted via assimp (fbx, obj…) | Conversion to GLB when needed |
| Gaussian splat | ply, splat formats | Splat pipeline (viewer-ready asset) |

Uploads stream to MinIO through presigned URLs and are tracked by a **global,
non-blocking upload widget**: you can keep navigating while uploads and processing
continue. Media status progresses `UPLOADING → PROCESSING → READY` (or `FAILED`
with an error you can retry from the UI).

Large files (≥ 16 MB) upload in **resumable parts**: if the connection drops,
re-uploading the same file to the same version picks up where it stopped. Every
file also carries a **sha256 checksum** verified after transfer, and content
already present in storage is **deduplicated** (instant upload). If the studio
enabled the antivirus, infected files are quarantined and marked FAILED.

## Drafts & review-before-publish

New versions are **drafts** by default. Drafts:

- are visible to their author (and supervisors) in a dedicated "pending drafts" area;
- can be reviewed, trimmed (video), transformed (3D), edited (splat) freely;
- become visible to the whole project only when **published**.

## The publish lock

Publishing is final. The published content is locked server-side (any structural
edit returns `403`): splat edits/mask, video trim, reprocess, 3D transform. Only the
**splat presentation** (staging) and the **thumbnail** stay editable. To fix a
published version, upload a **new version** — the version history keeps every
iteration side by side for comparison in review (A/B).

## Thumbnails

Thumbnails are generated automatically during processing, and can be overridden
manually (including on published versions).

## Related pages

- [Media processing](media-processing.md) — what happens after upload
- [Projects & pipeline](projects-and-pipeline.md) — versions, hierarchy
- [Review video](review-video.md), [Review 3D](review-3d.md), [Review splat](review-splat.md)
