# Jobs & workers

> Updated: 2026-07-18

Long-running work is queued in **BullMQ** (Redis) and processed by the dedicated
`worker` container — the API never blocks on media processing.

## Job types

| Job | Trigger | Output |
|-----|---------|--------|
| HLS transcode | Video upload complete | Multi-rendition HLS + thumbnails |
| Video trim | Trim requested in review (pre-publish) | Re-cut delivery |
| 3D conversion | Non-GLB 3D upload | GLB via assimp |
| Splat processing | Splat upload / edit ops | Viewer-ready artifacts |
| Thumbnails | Media processed / manual | Card & preview images |

## Lifecycle & monitoring

- Media status: `UPLOADING → PROCESSING → READY | FAILED`, pushed live to the UI
  via Socket.io.
- Failures keep the error message on the media; jobs can be retried from the UI
  without re-upload.
- Worker logs (pino) are visible with `docker compose logs -f worker`.

## Scaling

The worker is stateless: run several `worker` replicas against the same Redis to
increase throughput. FFmpeg is CPU-bound — size the containers accordingly.

## Related pages

- [Media processing (user guide)](../user-guide/media-processing.md)
- [Architecture](architecture.md)
