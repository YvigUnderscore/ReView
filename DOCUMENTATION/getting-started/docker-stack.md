# Docker stack

> Updated: 2026-07-18

`docker-compose.yml` defines six services and three named volumes.

## Services

| Service | Image | Role |
|---------|-------|------|
| `postgres` | `postgres:16-alpine` | Primary database (Prisma schema) |
| `minio` | `minio/minio` | S3-compatible object storage for all media (originals, HLS renditions, thumbnails, attachments) |
| `redis` | `redis:7-alpine` | Queue backend for BullMQ jobs |
| `backend` | built from `backend/` | Express 5 API + Socket.io realtime server |
| `worker` | built from `backend/` | FFmpeg / processing worker: HLS multi-rendition transcode, thumbnails, 3D→GLB conversion (assimp), splat processing |
| `frontend` | built from `frontend/` (context = repo root) | React app built by Vite, served by nginx; proxies `/api/` and `/socket.io/` to the backend |

## Data flow

1. The browser talks only to the **frontend** nginx (`:3429`), which serves the SPA
   and proxies API/WebSocket traffic to the backend.
2. Uploads go through the backend to **MinIO** using presigned URLs; the stored
   object keys live in PostgreSQL (`MediaObject.storageKey`).
3. After an upload completes, the backend enqueues a processing job in **Redis**;
   the **worker** picks it up (FFmpeg, assimp…), writes derived files back to MinIO
   and updates the media status (`UPLOADING → PROCESSING → READY | FAILED`).
4. Realtime events (presence, notifications, media status) are pushed over
   **Socket.io**.

## Volumes

| Volume | Content |
|--------|---------|
| `pgdata` | PostgreSQL data |
| `miniodata` | All media objects |
| `redisdata` | Queue state |

Back up `pgdata` + `miniodata` together: the database references MinIO object keys.

## Frontend build context

The frontend image is built with the **repo root** as Docker context
(`dockerfile: frontend/Dockerfile`) so the build can embed `DOCUMENTATION/` into the
app (`/docs` page). The root `.dockerignore` keeps that context small.

## Related pages

- [Architecture](../infrastructure/architecture.md)
- [Jobs & workers](../infrastructure/jobs-and-workers.md)
- [MinIO storage](../infrastructure/storage-minio.md)
