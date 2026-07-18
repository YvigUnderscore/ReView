# Video transcoding

> Updated: 2026-07-18

Configured in *Admin → Contextes de review → Vidéo*. Applies studio-wide; only
administrators can change it.

## HLS ladder

Uploaded videos are transcoded by the FFmpeg worker into **HLS with multiple
renditions** (heights such as 1080p/720p/480p, with per-rendition bitrates). The
master playlist references every rendition; the review player either adapts
automatically or pins the rendition chosen by the user.

Changes to the ladder apply to **new** uploads; existing media keep their
renditions unless reprocessed (reprocessing is blocked on published versions).

## Thumbnails & timeline assets

The worker also generates card thumbnails during processing.

## Operational notes

- Transcoding runs in the `worker` container; heavy queues only slow processing,
  never the API.
- Failures mark the media `FAILED` with the FFmpeg error in the UI; retry after
  fixing the source file.

## Related pages

- [Media processing (user guide)](../user-guide/media-processing.md)
- [Jobs & workers](../infrastructure/jobs-and-workers.md)
