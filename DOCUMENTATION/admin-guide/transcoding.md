# Video transcoding

> Updated: 2026-08-21

Configured in *Admin → Review contexts → Video* (`/admin/video`). The settings are
studio-wide and **only an `ADMIN` can read or change them**
(`GET`/`PUT /api/admin/transcode`, stored in `Setting.transcode_config`, audit action
`TRANSCODE_CONFIG_UPDATE`).

Changes apply to **new uploads and reprocesses only**. Existing media keep the
renditions they already have, and reprocessing is refused on published versions.

## The HLS ladder

Uploaded videos are transcoded by the FFmpeg worker into HLS with multiple
renditions. Built-in defaults, used whenever `Setting.transcode_config` is absent or
unreadable:

| Field | Default | Accepted range |
|-------|---------|----------------|
| `enabled` | **`true`** | boolean |
| `ladder` | 360p @ 800 kbps · 720p @ 2500 · 1080p @ 5000 · 2160p @ 14000 | height 144–4320, bitrate 100–100000 kbps |
| `maxHeight` | **2160** | 144–4320 |
| `preset` | **`veryfast`** | `ultrafast`, `superfast`, `veryfast`, `faster`, `fast`, `medium`, `slow` |
| `audioBitrateK` | **128** | 32–512 |
| `crf` | **23** | 0–51 |
| `sceneDetection` | **`false`** | boolean |

Fixed, not configurable: segment duration **2 s**, GOP = 2 × fps, `libx264` (or
NVENC, see below), AAC audio, `yuv420p`, VOD playlists, `master.m3u8` +
`{height}p.m3u8` + `{height}p_NNN.ts`.

**Rendition selection never upscales.** Only rungs with
`height <= min(sourceHeight, maxHeight)` are built. If a source is smaller than every
rung, a single rendition is produced at the source height using the smallest rung's
bitrate. Lowering `maxHeight` is therefore the honest way to stop paying for 4K
encodes; deleting the 2160p rung has the same effect.

Two behaviours that regularly cause confusion:

- **`crf` is inert.** It is validated, stored and returned by the API, but the worker
  never reads it. HLS renditions run in bitrate mode (`-b:v`/`-maxrate`/`-bufsize`
  from the ladder), and the MP4 proxy and the client derivative hard-code CRF 23 /
  preset `veryfast`. Change the ladder bitrates, not `crf`, to move quality.
- **`preset` only affects HLS renditions**, for the same reason.
- The ladder is **auto-sorted ascending by height** on save, and an empty ladder falls
  back to the built-in one.

> **API clients:** a `PUT /api/admin/transcode` that omits a field **resets that field
> to the built-in default** — the payload is sanitised against the fallback, not
> merged into the stored row. Always send the whole object. The admin UI does.

## Progressive availability

Renditions are built **lowest first** and published one at a time:

1. The rendition is uploaded to `derived/{mediaId}/hls/`.
2. `master.m3u8` is regenerated from only the renditions built so far and re-uploaded,
   so the published master never references a segment that does not exist yet.
3. On the **first** rendition the media flips to `READY` — playback opens while the
   higher qualities keep encoding. `metadata.hls` carries `building: true` until the
   last one lands.
4. The worker publishes an event on the Redis channel `review:worker-events`; the API
   relays it as `hls:changed` to the open review page and `media:update` to the
   project room, so new qualities appear in the player's quality selector without a
   reload.

This notification is best effort: if Redis is unavailable the transcode still
completes, the player simply does not refresh on its own.

HLS files are **not presigned** — they are proxied through
`GET /api/media/:id/hls/:file`, so HLS playback is subject to the normal
authentication and project-access checks rather than to a signed URL.

## Hardware acceleration (NVENC)

Not an admin setting. The encoder is chosen by the **environment variable
`VIDEO_ENCODER`**, `libx264` (default, CPU) or `h264_nvenc`. x264 presets are mapped
onto NVENC presets (`veryfast → p3`, `medium → p5`, …). If the configured encoder
fails at runtime the worker retries the whole encode with `libx264` and logs it, so a
missing GPU degrades to CPU rather than failing the job.

## Scene detection

Optional and **off by default** — it costs one extra FFmpeg analysis pass per video.

When enabled, the worker detects cuts at scene threshold **0.4** and writes shared
timeline markers named **"Plan n"** (the second shot is "Plan 2": shot 1 starts at
frame 0 and gets no marker), colour `#64748b`, capped at **120 markers** per video.

- Auto markers have **no author**. Editing or deleting them requires `ADMIN` or
  `SUPERVISOR` — the "you may edit your own marker" rule can never match them.
- They are **replaced on every reprocess**: the worker deletes authorless markers
  whose name starts with `Plan ` before writing the new set. A manually created
  marker, even one literally named "Plan 4", has an author and is safe.
- Detection runs *after* the media is `READY` and is best effort: an FFmpeg failure
  yields no markers and does not fail the job.

## Thumbnails & timeline assets

The worker also produces, best effort:

- a **card thumbnail** — one frame at duration / 2 (or 1 s if the duration is
  unknown), scaled to 640 px wide, at `derived/{mediaId}/thumbnail.jpg`;
- a **timeline hover sprite** — one JPEG grid used for scrub previews and the
  exportable contact sheet, at `derived/{mediaId}/timeline-sprite.jpg`. One tile every
  **3 s**, 160 px wide, at most **10 columns** and **240 tiles**; past ~12 minutes the
  interval stretches so the tile count stays at 240.

## Operational notes

- Transcoding runs in the `worker` container with **concurrency 2**. A heavy queue
  slows processing; it never slows the API.
- A failure sets the media to **`FAILED`** and stores the FFmpeg error in
  `metadata.processingError` (truncated to 500 characters), which the UI shows.
- **ClamAV**: an infected upload is moved to `quarantine/{mediaId}/{originalName}`,
  the source object is deleted, the media is marked `FAILED` and an audit entry
  `MEDIA_QUARANTINED` is written. The file is not deleted — it is quarantined, so you
  can hand it to whoever needs to look at it.
- A **checksum mismatch** between the client-declared `contentHash` and the stored
  object fails the job. That is the guard working, not a transcoding bug.

---

## Use case: diagnosing a medium stuck in processing

*An artist reports a shot that "has been spinning for twenty minutes".*

1. **Read the media status first.** `PROCESSING` means a job is running or queued;
   `FAILED` means it is over and the reason is already on screen; `UPLOADING` means
   the browser never finished the upload and no job was ever created.
2. `FAILED` → open the media; `metadata.processingError` is displayed. Common causes:
   an unreadable container, a checksum mismatch (re-upload), or a ClamAV hit (the
   object is in `quarantine/`, not lost).
3. `PROCESSING` → *Admin → Maintenance → Jobs*. The `media` queue shows counts plus
   the recent active, waiting and failed jobs with their `failedReason` and
   `attemptsMade`.
   - Job **active** and the queue busy: it is simply queued behind others. Worker
     concurrency is 2; a 4K ladder of four rungs is minutes of work per file.
   - Job **failed**: retry it from the same screen, or retry every failed media job at
     once (`POST /api/admin/jobs/retry`).
   - **No job at all** for that media: the enqueue never happened. Check the worker
     container is up and Redis is reachable (*Admin → Studio → System* shows the
     health of database, Redis and MinIO).
4. If it is `READY` but only offers a low quality, that is progressive publishing
   working as designed — higher rungs are still encoding. `metadata.hls.building`
   tells you whether more are coming.
5. If the job keeps failing on one file, do not fight it: fix the source and upload a
   new version. Reprocessing a **published** version is refused with
   `403 PUBLISHED_LOCKED`, by design — see the publication lock in
   [Media processing](../user-guide/media-processing.md).

## Use case: cutting encoding cost on a delivery-only studio

*Nobody reviews above 1080p, but every upload is transcoded to 2160p.*

1. *Admin → Review contexts → Video*: set `maxHeight` to `1080` **and** remove the
   2160p rung. Either alone is enough, both together document the intent.
2. Consider dropping the 360p rung if everyone is on studio LAN — it is the rung built
   first, so keeping it is what makes playback start early on poor connections. Do not
   remove it if anyone reviews from home.
3. Leave `preset` at `veryfast` unless the machine is idle; `medium` roughly doubles
   encode time for a modest bitrate saving at the same quality.
4. The change affects **new uploads only**. Existing 4K renditions stay on disk; to
   reclaim that space use the derived purge (see
   [System & maintenance](system-and-maintenance.md#derived-files-purge)).

## Use case: turning on scene detection mid-show

*Editorial wants cut markers on the reel from now on.*

1. Enable *Scene detection* in the Video tab. It applies to new uploads only.
2. Warn supervisors that auto markers are **replaced on every reprocess** and are only
   editable by `ADMIN`/`SUPERVISOR`. An artist who renames "Plan 7" to "insert car"
   cannot do it, and if a manager does it the name is lost the next time the media is
   reprocessed.
3. Expect an extra analysis pass per video: on a busy queue with concurrency 2, this
   is a real throughput cost. Turn it back off after the reel is done if it was for a
   one-off.

## Related pages

- [Media processing (user guide)](../user-guide/media-processing.md)
- [Storage map](storage.md)
- [System & maintenance](system-and-maintenance.md)
- [Secure distribution](secure-distribution.md) — burn-ins are applied at the same step
- [Jobs & workers](../infrastructure/jobs-and-workers.md)
