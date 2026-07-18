# Media processing

> Updated: 2026-07-18

After an upload completes, the backend enqueues a job (BullMQ/Redis) processed by
the FFmpeg worker. The media stays usable in the UI while processing runs; its
status is pushed live over Socket.io.

## Video → adaptive HLS

Videos are transcoded to **HLS with multiple renditions** (e.g. 1080p/720p/480p —
the ladder is configured by administrators, see
[Transcoding](../admin-guide/transcoding.md)). The review player:

- starts on an adaptive quality and lets the user **pin a specific rendition**;
- keeps **frame accuracy** (frame-by-frame stepping uses the media framerate
  resolved from the pipeline settings);
- generates **thumbnails** for cards and timeline.

Videos can be **trimmed** (in/out) before publication; the trim is applied by the
worker and locked once published.

## Images

Images get thumbnails and are served directly (presigned URLs) to the image viewer.

## 3D models

GLB/glTF files are used as-is; other formats (FBX, OBJ…) are converted to **GLB**
by the worker using assimp. The original file is kept in storage.

## Gaussian splats

Splat files are prepared for the Spark viewer. The **original file is never
modified**: every edit (selection mask, tint, transform…) is stored as
non-destructive metadata and replayed identically for every viewer
(see [Review splat](review-splat.md)).

## Failures & retries

A failed job marks the media `FAILED` with the error surfaced in the UI; processing
can be retried without re-uploading. Reprocessing is blocked on published versions
(publish lock).

## Related pages

- [Jobs & workers](../infrastructure/jobs-and-workers.md)
- [Transcoding (admin)](../admin-guide/transcoding.md)
