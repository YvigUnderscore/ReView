# Video transcoding

> Updated: 2026-07-19

Configured in *Admin → Contextes de review → Vidéo*. Applies studio-wide; only
administrators can change it.

## HLS ladder

Uploaded videos are transcoded by the FFmpeg worker into **HLS with multiple
renditions** (heights such as 1080p/720p/480p, with per-rendition bitrates). The
master playlist references every rendition; the review player either adapts
automatically or pins the rendition chosen by the user.

Changes to the ladder apply to **new** uploads; existing media keep their
renditions unless reprocessed (reprocessing is blocked on published versions).

### Progressive availability

Renditions are built **lowest first** and published one by one: the media becomes
playable (`READY`) as soon as the **first rendition** is done, while higher
qualities keep transcoding in the background. The master playlist is regenerated
after each rendition and open review pages are notified in real time — new
qualities appear in the player's selector without a reload.

## Scene detection

Optional (**off by default** — it adds one FFmpeg analysis pass per video). When
enabled, the worker detects cuts (scene threshold 0.4) and places shared timeline
markers named **"Plan n"** at each detected shot start (capped at 120 markers).
Auto markers have no author: only supervisors/admins can rename or delete them,
and they are replaced when the media is reprocessed.

## Thumbnails & timeline assets

The worker also generates card thumbnails, a **timeline hover sprite** (one JPEG
grid, ~1 tile / 3 s) used for scrub previews and the exportable contact sheet.

## Operational notes

- Transcoding runs in the `worker` container; heavy queues only slow processing,
  never the API.
- Worker → server real-time notifications (progressive renditions, auto markers)
  travel over a Redis pub/sub channel (`review:worker-events`); they are best
  effort and never fail a job.
- Failures mark the media `FAILED` with the FFmpeg error in the UI; retry after
  fixing the source file.

## Related pages

- [Media processing (user guide)](../user-guide/media-processing.md)
- [Jobs & workers](../infrastructure/jobs-and-workers.md)
