# Spatial thumbnails (3D and Gaussian splat)

> Updated: 2026-08-22

Video and image media get a thumbnail from the FFmpeg worker. 3D and splat media used to
get nothing: every tile stayed empty in lists, kanban cards, playlists and dailies until
somebody opened the review and captured the viewport by hand. A dedicated worker now
renders that thumbnail server-side, right after upload (or right after the GLB conversion
finishes).

## What it renders

| Media | Chain | Output |
|-------|-------|--------|
| `MODEL_3D` (any source format) | Blender headless, Cycles on CPU, from the derived `model.glb` — or from the file itself when it is already a `.glb` | `derived/<mediaId>/thumbnail.png`, 512×512, transparent background |
| `SPLAT` stored as `.ply` or `.splat` | Built-in point rasteriser: the splat centres are streamed, sampled (160 000 points max) and projected | `derived/<mediaId>/thumbnail.png`, 512×512, transparent background |
| `SPLAT` stored as `.spz`, `.ksplat`, `.sog`, `.sogs` | **Nothing is queued** — see below | — |

Both chains use the same three-quarter view (azimuth 35°, elevation 22°) so 3D assets and
scans look consistent side by side in a list. The background is transparent, so the tile
takes the colour of the active theme.

## Guarantees

- **The media status is never touched.** A thumbnail is decorative: a render that cannot
  happen is a *successful* job with no image. No media can be stuck in `PROCESSING`, be
  marked `FAILED`, or have its publication delayed because of a thumbnail.
- **An existing thumbnail is never overwritten.** The key is written with a conditional
  update on `thumbnailKey IS NULL` — the same guard the client-side capture uses. The job
  is therefore idempotent and safe to replay; a thumbnail chosen by hand always wins.
- **Bounded duration.** The Blender render is killed after 10 minutes
  (`BLENDER_THUMB_TIMEOUT_MS`, capped by `MODEL_CONVERT_TIMEOUT_MS`), following the same
  pattern as the FFmpeg step timeouts. Splat files are streamed, never loaded in memory,
  so a multi-gigabyte scan costs constant RAM.
- **Isolated from transcoding.** The work runs on its own BullMQ queue, `spatial-thumb`,
  at concurrency 1 — a Cycles render must not starve the `media-processing` queue, which
  is the one users are waiting on.

## Requirements and degraded modes

Blender is only present in the worker image when it is built with
`--build-arg INSTALL_USD_TOOLS=1` (see [3D & USD](3d-usd.md)). Without it:

- 3D thumbnails are skipped. The job logs `média <id> non rendu (blender-missing)` and
  completes successfully.
- Splat thumbnails are **unaffected**: the point rasteriser has no external dependency.

Other reasons a job legitimately produces no image, all logged with an explicit cause:
`no-geometry` (the GLB contains no renderable object), `import-failed`, `degenerate-bounds`,
`ascii-ply`, `compressed-ply` (PlayCanvas compressed PLY), `no-visible-point` (every
Gaussian below the opacity threshold), `timeout:600s`.

Compressed splat containers (`.spz`, `.ksplat`, `.sog`, `.sogs`) are deliberately **not**
queued. Decoding them approximately would produce a wrong image that nobody would notice;
those media keep relying on the automatic capture performed by the viewer the first time
somebody opens the review.

## Scheduling

The job is queued when the upload is finalised, and again on *reprocess*. When the media
still needs a GLB conversion, the first attempts find nothing to render and the job is
rescheduled with exponential backoff (8 attempts, 30 s base, a little over an hour in
total) — long enough for a heavy USD scene.

The job id is deterministic (`spatial-thumb-<mediaId>`), so two uploads or a double
reprocess never start two renders for the same media.

## Operations

The queue appears in *Admin → Jobs* metrics under the label `spatial-thumb`, next to
`media`, `webhooks` and the others. Failures there are never user-visible: check them when
tiles stay empty, and look for the cause string in the worker logs.
