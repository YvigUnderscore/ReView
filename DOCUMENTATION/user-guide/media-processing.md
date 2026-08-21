# Media processing

> Updated: 2026-08-21

After an upload completes, the backend enqueues a job (BullMQ/Redis) processed by
the media worker. The media stays usable in the UI while processing runs; its
status is pushed live over Socket.io.

## The path a file takes

1. **Upload finishes.** The object is in MinIO but the media is still `UPLOADING`.
2. **The bytes are checked.** ReView reads the file header rather than trusting the
   extension or the content type the browser announced, and normalises the stored content
   type — objects are served from the application origin, so a file that claimed to be
   `text/html` must not stay that way.
3. **A job is chosen** from the media kind and what was actually detected.
4. **Antivirus** (ClamAV, when enabled) runs before anything else. A detection quarantines
   the media and records an audit entry; nothing else is produced.
5. **The job runs**, writes its outputs under `derived/<mediaId>/…`, and the media becomes
   `READY`.

| Media | Job | What it produces |
|---|---|---|
| Video | `transcode` | Probe (duration, fps, resolution), MP4 proxy, adaptive HLS ladder, poster thumbnail, timeline sprite |
| Image | `thumbnail` | Probe (dimensions), JPEG thumbnail |
| 3D model needing conversion | `convert3d` | A GLB the Three.js viewer can open, plus conversion provenance |
| Native `.glb`, Gaussian splat | *(none)* | Served as-is — `READY` immediately, with a `scan` job when ClamAV is on |

## Video → adaptive HLS

Videos are transcoded to **HLS with multiple renditions** (e.g. 1080p/720p/480p —
the ladder is configured by administrators, see
[Transcoding](../admin-guide/transcoding.md)). The renditions are produced lowest first
and published as they finish, so playback can start before the whole ladder is ready.

Alongside the ladder, the worker writes:

- an **MP4 proxy** — the fallback when HLS is unavailable, and the source of the
  frame-accurate scrub;
- a **poster thumbnail**, taken at the midpoint of the clip (one second in when the
  duration cannot be probed) — far more representative than the first frame, which is
  often black;
- a **timeline sprite**, the strip of small frames that appears when hovering the
  scrub bar.

The review player:

- starts on an adaptive quality and lets the user **pin a specific rendition**;
- keeps **frame accuracy** (frame-by-frame stepping uses the media framerate
  resolved from the pipeline settings);
- shows the sprite on hover and the thumbnail on cards.

The sprite is best-effort: if it fails, the transcode still succeeds and the media is
usable — you simply get no hover preview.

**Burn-ins** (shot name, version, frame counter, watermark) are composited during the
transcode from the project's effective configuration. Resolving them is also best-effort:
a burn-in that cannot be resolved is logged and skipped rather than failing the job. See
[Secure distribution](../admin-guide/secure-distribution.md).

### Trimming

Videos can be **trimmed** (in/out) before publication. The trim is non-destructive: the
original is untouched and the worker renders a separate trimmed proxy from it, so changing
your mind costs one job and no re-upload.

Two consequences worth knowing:

- Changing or clearing the trim while its job is running is safe. The worker re-reads the
  trim before recording its output and discards the render if the values moved.
- A failed trim does **not** mark the media as failed — the untrimmed proxy is still
  served.

Trims are locked once the version is published (publish lock).

## Images

Images are probed for their dimensions, get a JPEG thumbnail, and are served directly
through presigned URLs to the image viewer. No re-encoding: the reviewer sees the file
that was uploaded.

## 3D models

The routing depends on the source format, and it is not one converter:

| Source | Handling |
|---|---|
| `.glb` | Served as-is |
| `.gltf` | Packed to GLB (resolves the `.bin` and relative textures) |
| `.usd` / `.usdc` / `.usda` / `.usdz` | Blender (OpenUSD), falling back to `guc`, then assimp |
| `.zip` | The main model inside; USD archives resolve their root layer |
| `.fbx` `.obj` `.dae` `.stl` | assimp |

The original file is always kept in storage — the GLB is a derived view, not a
replacement. Which converter produced it is recorded and shown in the review's technical
sheet, together with the USD scene description when there is one. Full details:
[USD & 3D conversion](../admin-guide/3d-usd.md).

## Gaussian splats

Splat files are served to the Spark viewer without a conversion pass, so they become
reviewable as soon as the upload lands. The **original file is never modified**: every
edit (selection mask, tint, transform…) is stored as non-destructive metadata and
replayed identically for every viewer (see [Review splat](review-splat.md)).

## Failures & retries

A failed job marks the media `FAILED` **and keeps the reason**: the message is stored on
the media and shown in the review, so a USD scene that failed because a texture was
missing from the archive says so instead of showing a mute error. The same message is in
`docker compose logs worker`.

Processing can be retried without re-uploading. Reprocessing is blocked on published
versions (publish lock) — publish a new version instead.

Two job kinds deliberately never mark a media as failed:

- `trim`, because the original proxy is still perfectly playable;
- `scan`, because an unreachable ClamAV daemon is an infrastructure problem, not a bad
  file. BullMQ retries; only an actual detection quarantines the media.

### What to check first

| Symptom | Look at |
|---|---|
| Media stuck in `PROCESSING` | The worker is down or the queue is backed up — [Jobs & workers](../infrastructure/jobs-and-workers.md) |
| `FAILED` with a message about a converter | The USD toolchain may not be installed in the worker image — [USD & 3D conversion](../admin-guide/3d-usd.md#troubleshooting) |
| Video plays but has no quality selector | The HLS ladder is disabled or still building — [Transcoding](../admin-guide/transcoding.md) |
| No preview when hovering the scrub bar | The sprite failed; the rest of the transcode is fine |
| Media disappeared right after upload | It was quarantined by the antivirus; the audit log records it |

## Related pages

- [Upload & publishing](upload-and-publishing.md)
- [Jobs & workers](../infrastructure/jobs-and-workers.md)
- [Transcoding (admin)](../admin-guide/transcoding.md)
- [USD & 3D conversion (admin)](../admin-guide/3d-usd.md)
