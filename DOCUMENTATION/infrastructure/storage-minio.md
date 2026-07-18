# MinIO storage

> Updated: 2026-07-18

All binaries live in MinIO (S3-compatible), referenced from PostgreSQL by object
key (`MediaObject.storageKey` and friends).

## Layout & lifecycle

- Originals are uploaded via **presigned PUT URLs** (the browser talks to MinIO
  directly; the API never proxies file bytes).
- The worker writes derived objects (HLS playlists/segments, thumbnails, converted
  GLBs, splat artifacts) next to the original, per media.
- Reads use **presigned GET URLs** with limited lifetime, issued only after RBAC
  checks.
- Deletions are soft in the app; purging from the admin trash removes the storage
  objects.

## Splat specifics

Splat originals are **immutable**; edits are stored as compact binary ops and
masks (bitsets) in MinIO plus metadata in PostgreSQL, and replayed by the viewer.

## Operations

- Console available on port `9001` (credentials from the environment).
- Back up `miniodata` together with `pgdata` — keys in the DB must match objects.

## Related pages

- [Architecture](architecture.md)
- [Docker stack](../getting-started/docker-stack.md)
