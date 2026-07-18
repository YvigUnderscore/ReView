# Architecture

> Updated: 2026-07-18

```
Browser ── nginx (frontend :3429)
              │  static SPA (React 19 / Vite 7)
              │  /api/*  /socket.io/*  ──► backend (Express 5 + Socket.io)
                                              │
                     ┌────────────────────────┼──────────────────┐
                 PostgreSQL 16            Redis 7 (BullMQ)    MinIO (S3)
                 (Prisma ORM)                 │                │
                                          worker (FFmpeg, assimp, splat)
```

## Backend

- **Express 5 + TypeScript**, Prisma ORM on PostgreSQL.
- Layering: routes (thin, ≤ 200 lines: validate → service → respond) → `services/`
  and `lib/` for business logic. Zod validation and RBAC middleware on every
  route; typed errors; pino logging.
- **Socket.io** for realtime: presence, notifications, media processing status,
  project rooms.
- Multi-step writes run in `prisma.$transaction`; MinIO side effects happen after
  commit.

## Worker

Separate container running the same codebase (`workers/ffmpeg.worker.ts`),
consuming BullMQ queues: HLS multi-rendition transcode, thumbnails, video trim,
3D→GLB conversion (assimp), splat processing. Retries and failures update the
media status.

## Frontend

- **React 19 + Vite 7 + Tailwind**, shadcn-style primitives, TanStack Query for
  all data fetching, Zustand for cross-page state (uploads, auth).
- Single-page app served by nginx, which also proxies `/api` and `/socket.io` —
  the browser only ever talks to one origin.

## Storage model

- PostgreSQL holds all metadata; **MinIO holds every binary** (originals, HLS
  segments, thumbnails, attachments, HDRIs) referenced by object key.
- Media URLs are **presigned** and short-lived.

## Production notes

A TLS-terminating nginx (or any reverse proxy) fronts the compose stack in
production. The backend refuses weak `JWT_SECRET` values in production mode.

## Related pages

- [Docker stack](../getting-started/docker-stack.md)
- [Jobs & workers](jobs-and-workers.md)
- [MinIO storage](storage-minio.md)
- [Security model](security.md)
