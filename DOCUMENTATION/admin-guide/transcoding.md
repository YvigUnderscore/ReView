# Video transcoding

*The studio-wide HLS ladder, everything the worker derives from one upload, and how the bytes actually reach a player.*

> Updated: 2026-08-23

Configured in *Admin → Review contexts → Video* (`/admin/video`). The settings are
studio-wide and **only an `ADMIN` can read or change them**
(`GET`/`PUT /api/admin/transcode`, stored in `Setting.transcode_config`, audit action
`TRANSCODE_CONFIG_UPDATE`).

Changes apply to **new uploads and reprocesses only**. Existing media keep the renditions
they already have, and reprocessing is refused on published versions with
`403 PUBLISHED_LOCKED`.

## The HLS ladder

Uploaded videos are transcoded by the FFmpeg worker into HLS with multiple renditions.
Built-in defaults, used whenever `Setting.transcode_config` is absent or unreadable:

| Field | Default | Accepted range |
|-------|---------|----------------|
| `enabled` | **`true`** | boolean — `false` falls back to a single MP4 proxy |
| `ladder` | 360p @ 800 kbps · 720p @ 2500 · 1080p @ 5000 · 2160p @ 14000 | height 144–4320, bitrate 100–100000 kbps |
| `maxHeight` | **2160** | 144–4320 |
| `preset` | **`veryfast`** | `ultrafast`, `superfast`, `veryfast`, `faster`, `fast`, `medium`, `slow` |
| `audioBitrateK` | **128** | 32–512 |
| `crf` | **23** | 0–51 |
| `sceneDetection` | **`false`** | boolean |

Fixed, not configurable: segment duration **2 s**, GOP = 2 × fps (one keyframe per segment,
scene-cut disabled), `libx264` (or NVENC, see below), AAC audio, `yuv420p`, VOD playlists,
`master.m3u8` + `{height}p.m3u8` + `{height}p_NNN.ts`.

**Rendition selection never upscales.** Only rungs with
`height <= min(sourceHeight, maxHeight)` are built. If a source is smaller than every rung, a
single rendition is produced at the source height using the smallest rung's bitrate. Lowering
`maxHeight` is therefore the honest way to stop paying for 4K encodes; deleting the 2160p rung
has the same effect.

Three behaviours that regularly cause confusion:

- **`crf` is inert.** It is validated, stored and returned by the API, but the worker never
  reads it. HLS renditions run in bitrate mode (`-b:v` / `-maxrate` / `-bufsize` from the
  ladder), and the MP4 proxy, the client derivative and the image-sequence master hard-code
  their own quality (CRF 23 / preset `veryfast`). Change the ladder bitrates, not `crf`, to
  move quality.
- **`preset` only affects HLS renditions**, for the same reason.
- The ladder is **auto-sorted ascending by height** on save, and an empty ladder falls back to
  the built-in one.

> [!WARNING]
> A `PUT /api/admin/transcode` that omits a field **resets that field to the built-in
> default** — the payload is sanitised against the fallback, not merged into the stored row.
> Always send the whole object. The admin screen does.

## What one upload produces

The ladder is the visible part; a single job writes rather more than that.

![From the untouched original — or from a prefix of frames plus a sequence manifest — the worker derives an MP4 proxy, the HLS ladder, a thumbnail, a hover sprite, a burnt-in client derivative, an audio waveform in the metadata, and optional scene-detection markers.](../assets/admin-guide/worker-derivatives.svg)

| Derivative | Where | Notes |
|------------|-------|-------|
| MP4 proxy | `derived/{id}/proxy.mp4` | CRF 23 / `veryfast`, height capped at 1080, `+faststart` |
| HLS ladder | `derived/{id}/hls/` | master + one playlist and its segments per rung |
| Card thumbnail | `derived/{id}/thumbnail.jpg` | one frame at duration / 2 (or 1 s if the duration is unknown), 640 px wide |
| Timeline hover sprite | `derived/{id}/timeline-sprite.jpg` | one tile every **3 s**, 160 px wide, at most **10 columns** and **240 tiles**; past ~12 minutes the interval stretches so the count stays at 240 |
| Client derivative | `derived/{id}/client.mp4` | slate + burn-ins, served only to client shares — see [Secure distribution](secure-distribution.md) |
| Audio waveform | `metadata.waveform` | one peak byte per bar, **8 bars per second**, 64 to 1200 bars, base64 |
| Scene markers | shared timeline markers | opt-in, see below |

The **waveform** deserves a word because it costs nothing to run and is easy to miss. The
worker extracts the first audio track as mono 8 kHz PCM, keeps one peak byte per bar and
throws the PCM away. A few hundred bytes travel with the media's metadata: no derived object
to store, no presigned URL to regenerate, and the player can show a lip-sync drift or a
dropped line of dialogue without anyone listening to the whole file.

The thumbnail, the sprite, the waveform and the scene markers are **best effort**: a failure
there logs and moves on rather than failing the job. The proxy, the ladder and the checksum
are not.

> [!NOTE]
> The uploaded original is never modified — every derivative is a new object under
> `derived/{mediaId}/`. See the [storage map](storage.md).

## Image sequences are transcoded like videos

An EXR, DPX or TIFF delivery is **one media of kind `VIDEO`** whose source is not a single
object but a MinIO prefix of frames plus a manifest:

```
projects/{slug}/…/{mediaId}/frames/SH0100_comp_v003.1001.exr
projects/{slug}/…/{mediaId}/sequence.json
```

The worker downloads the frames, scans them if ClamAV is on, and assembles a **master** once
(CRF 12, `veryfast`) rather than re-decoding two thousand EXRs for each derivative. From that
point the whole downstream — proxy, ladder, thumbnail, sprite, waveform, frame-accurate
annotations — runs unchanged and has no idea where the master came from. A reprocess always
restarts from the frames, never from the proxy: unlike a video, the original delivery is still
there.

Bounds, refused explicitly rather than truncated: at least **2** frames
(`SEQUENCE_TOO_SHORT`), at most **10 000** (`SEQUENCE_TOO_LONG`), frame names restricted to
alphanumerics, dot, dash and underscore (`BAD_FRAME_NAME`), and a pattern that must parse as
`name.%04d.ext` (`BAD_PATTERN`). See [Image sequences](../user-guide/image-sequences.md).

## Progressive availability

Renditions are built **lowest first** and published one at a time:

1. The rendition is uploaded to `derived/{mediaId}/hls/`.
2. `master.m3u8` is regenerated from only the renditions built so far and re-uploaded, so the
   published master never references a segment that does not exist yet.
3. On the **first** rendition the media flips to `READY` — playback opens while the higher
   qualities keep encoding. `metadata.hls` carries `building: true` until the last one lands.
4. The worker publishes an event on the Redis channel `review:worker-events`; the API relays
   it as `hls:changed` to the open review page and `media:update` to the project room, so new
   qualities appear in the player's quality selector without a reload.

This notification is best effort: if Redis is unavailable the transcode still completes, the
player simply does not refresh on its own.

> [!TIP]
> The 360p rung is the one built first, so keeping it is what makes playback start early on a
> poor connection. Drop it only if nobody ever reviews from home.

## How playback is actually served

HLS is **not** served the way the rest of the media is, and it is not fully proxied either.

![The player asks the API for the master playlist, which pays the full authorisation check and returns a playback token; the rendition playlist comes back with every segment rewritten into an absolute presigned MinIO URL, and the segment bytes go straight from MinIO to the player.](../assets/admin-guide/hls-request-path.svg)

- `GET /api/media/:id/hls/master.m3u8` is the **only** request that pays the full
  authentication and project-access check in database. It answers `Cache-Control: private, no-store`
  and hangs a **playback token** (`?pt=…`) on every rendition URI. The token names the media
  *and* the reader, expires after **2 h**, and carries a `kind` claim that
  `middleware/auth` refuses as an access token — it can never authenticate an API call.
- `GET /api/media/:id/hls/{height}p.m3u8?pt=…` verifies the token (an HMAC check, no database
  round-trip) and returns the playlist **rewritten on the fly**: every segment URI becomes an
  absolute **presigned MinIO URL**, TTL 2 h.
- The signing date is pinned to the current **15-minute window**, so twenty people watching
  the same daily receive identical URLs and a front-end cache is worth something. The
  consequence to know: a ladder regenerated by a reprocess can be announced with up to one
  window of delay.
- Segment bytes therefore **never traverse Node**. A segment served through the API remains
  possible as a fallback — an unexpected file name is left relative rather than presigned, and
  the proxy route still answers — so nothing breaks, it is just slower.

Everything else (originals, thumbnails, proxies) is presigned directly: `PUT` 15 minutes,
`GET` 1 hour. Access to the master is logged for the media access journal, deduplicated per
30-minute window, so viewing stays traceable even though the segments left the API.

## Hardware acceleration (NVENC)

Not an admin setting. The encoder is chosen by the **environment variable `VIDEO_ENCODER`**,
`libx264` (default, CPU) or `h264_nvenc`. x264 presets are mapped onto NVENC presets
(`veryfast → p3`, `medium → p5`, …). If the configured encoder fails at runtime the worker
retries the whole encode with `libx264` and logs it, so a missing GPU degrades to CPU rather
than failing the job. An FFmpeg **timeout** is not retried that way: it is a real failure.

## Scene detection

Optional and **off by default** — it costs one extra FFmpeg analysis pass per video.

When enabled, the worker detects cuts at scene threshold **0.4** and writes shared timeline
markers named **"Plan n"** (the second shot is "Plan 2": shot 1 starts at frame 0 and gets no
marker), colour `#64748b`, capped at **120 markers** per video.

- Auto markers have **no author**. Editing or deleting them requires `ADMIN` or `SUPERVISOR` —
  the "you may edit your own marker" rule can never match them.
- They are **replaced on every reprocess**: the worker deletes authorless markers whose name
  starts with `Plan ` before writing the new set. A manually created marker, even one literally
  named "Plan 4", has an author and is safe.
- Detection runs *after* the media is `READY` and is best effort: an FFmpeg failure yields no
  markers and does not fail the job.

## Operational notes

- Transcoding runs in the `worker` container with **concurrency 2**. A heavy queue slows
  processing; it never slows the API.
- The worker publishes its **step and percentage** on the BullMQ job — `download`, `probe`,
  `proxy`, `thumbnail`, `renditions` (with `n / N`), `client`, `scenes`, `sprite`, `done` —
  which is the only thing that tells a six-hour encode apart from a six-hour stall. The
  *Admin → Maintenance → Jobs* screen does **not** display it yet: it shows counts,
  `failedReason` and `attemptsMade`. Any BullMQ dashboard pointed at the same Redis reads the
  progress.
- A failure sets the media to **`FAILED`** and stores the FFmpeg error in
  `metadata.processingError` (trimmed to 500 characters), which the UI shows.
- **ClamAV**: an infected upload is moved to `quarantine/{mediaId}/{originalName}`, the source
  object is deleted, the media is marked `FAILED` and an audit entry `MEDIA_QUARANTINED` is
  written. The file is not deleted — it is quarantined, so you can hand it to whoever needs to
  look at it.
- A **checksum mismatch** between the client-declared `contentHash` and the stored object fails
  the job. That is the guard working, not a transcoding bug.

> [!IMPORTANT]
> The *Jobs* screen exposes **three** of the eight declared queues: `media`,
> `storage-cleanup` and `webhooks`. An ingestion that fails in `spatial-thumb`,
> `timeline-export`, `shotgrid`, `maintenance` or `ocio-bake` leaves no trace there. See
> [Jobs & workers](../infrastructure/jobs-and-workers.md) for the full list and how to watch
> the others.

## Use case: diagnosing a medium stuck in processing

*An artist reports a shot that "has been spinning for twenty minutes".*

1. **Read the media status first.** `PROCESSING` means a job is running or queued; `FAILED`
   means it is over and the reason is already on screen; `UPLOADING` means the browser never
   finished the upload and no job was ever created.
2. `FAILED` → open the media; `metadata.processingError` is displayed. Common causes: an
   unreadable container, a checksum mismatch (re-upload), or a ClamAV hit (the object is in
   `quarantine/`, not lost).
3. `PROCESSING` → *Admin → Maintenance → Jobs*. The `media` queue shows counts plus the recent
   active, waiting and failed jobs with their `failedReason` and `attemptsMade`.
   - Job **active** and the queue busy: it is simply queued behind others. Worker concurrency
     is 2; a 4K ladder of four rungs is minutes of work per file, and an EXR sequence is
     minutes more just to assemble its master.
   - Job **failed**: retry it from the same screen
     (`POST /api/admin/jobs/:queue/:id/retry`, audit `JOB_RETRY`), or clear the failed set
     with *clean failed* once you have read them.
   - **No job at all** for that media: the enqueue never happened. Check the worker container
     is up and Redis is reachable (*Admin → Studio → System* shows the health of database,
     Redis and MinIO).
4. If it is `READY` but only offers a low quality, that is progressive publishing working as
   designed — higher rungs are still encoding. `metadata.hls.building` tells you whether more
   are coming.
5. If the job keeps failing on one file, do not fight it: fix the source and upload a new
   version. Reprocessing a **published** version is refused with `403 PUBLISHED_LOCKED`, by
   design — see the publication lock in
   [Media processing](../user-guide/media-processing.md).

## Use case: cutting encoding cost on a delivery-only studio

*Nobody reviews above 1080p, but every upload is transcoded to 2160p.*

1. *Admin → Review contexts → Video*: set `maxHeight` to `1080` **and** remove the 2160p rung.
   Either alone is enough, both together document the intent.
2. Consider dropping the 360p rung if everyone is on studio LAN — it is the rung built first,
   so keeping it is what makes playback start early on poor connections. Do not remove it if
   anyone reviews from home.
3. Leave `preset` at `veryfast` unless the machine is idle; `medium` roughly doubles encode
   time for a modest bitrate saving at the same quality.
4. The change affects **new uploads only**. Existing 4K renditions stay on disk; to reclaim
   that space use the derived purge (see
   [System & maintenance](system-and-maintenance.md)).

## Use case: turning on scene detection mid-show

*Editorial wants cut markers on the reel from now on.*

1. Enable *Scene detection* in the Video tab. It applies to new uploads only.
2. Warn supervisors that auto markers are **replaced on every reprocess** and are only editable
   by `ADMIN`/`SUPERVISOR`. An artist who renames "Plan 7" to "insert car" cannot do it, and if
   a manager does it the name is lost the next time the media is reprocessed.
3. Expect an extra analysis pass per video: on a busy queue with concurrency 2, this is a real
   throughput cost. Turn it back off after the reel is done if it was for a one-off.

## Use case: reviewers report stuttering on a good connection

*Playback stalls even though the network is fine.*

Segments come from MinIO, not from the API, so the API's load is not the suspect. Check, in
order: that the MinIO endpoint published to browsers (`S3_PUBLIC_ENDPOINT`) is reachable from
the reviewer's network and served over TLS; that the front-end proxy is not stripping the
query string of presigned URLs; and that the ladder has a rung low enough for the connection.
A rewritten playlist that fell back to relative URIs — an unexpected segment name — sends every
segment back through Node and looks exactly like this. See
[HLS delivery](../infrastructure/hls-delivery.md).

## Related pages

- [Media processing (user guide)](../user-guide/media-processing.md)
- [Image sequences (user guide)](../user-guide/image-sequences.md)
- [Storage map](storage.md)
- [System & maintenance](system-and-maintenance.md)
- [Secure distribution](secure-distribution.md) — burn-ins are applied at the same step
- [Jobs & workers](../infrastructure/jobs-and-workers.md)
- [HLS delivery](../infrastructure/hls-delivery.md)
