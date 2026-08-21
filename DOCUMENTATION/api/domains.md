# API domains

> Updated: 2026-08-21

One router per domain (`backend/src/routes/*.routes.ts`), mounted in
`backend/src/app.ts`. Full parameter-level detail lives in the interactive reference at
`/api/docs`.

Mount order matters and explains a few surprises: literal sub-paths are declared before
`/:id` so that `/api/tasks/board` is not read as a task id, and several routers share
one prefix (`/api/media` is served by six routers, `/api/auth` by four).

## Outside `/api`

| Route | Domain |
|-------|--------|
| `GET /health` | Liveness probe, `{ "status": "ok" }` |
| `GET /metrics` | Prometheus metrics, guarded by `METRICS_TOKEN` when set |

## Authentication and identity

| Prefix | Domain |
|--------|--------|
| `/api/setup` | First-run studio/admin creation (empty DB only): `GET /status`, `POST /` |
| `/api/auth` | Login, refresh, logout, register, invitation activation, current user |
| `/api/auth/2fa` | TOTP: `setup`, `enable`, `disable`, `verify` |
| `/api/auth/oidc` | SSO: `status`, `login`, `callback` |
| `/api/auth/sessions`, `/api/auth/tokens`, `/api/auth/scopes` | Active sessions, personal API tokens, scope catalogue |
| `/api/users` | Directory, member sheet, avatar, preferences, departments; `DELETE /:id/sessions` (admin) |
| `/api/unsubscribe` | Public unsubscribe endpoint for recurring mail |

## Studio and pipeline

| Prefix | Domain |
|--------|--------|
| `/api/studio` | Studio settings, appearance/branding, SMTP configuration |
| `/api/studio/hdris` | HDRI library |
| `/api/studio/ocio` | OCIO configurations |
| `/api/projects` | Projects CRUD, membership, settings; plus `GET /usage`, `GET /:projectId/usage`, `POST /:projectId/duplicate`, `POST /:projectId/import-csv`, `GET /:projectId/export-csv` |
| `/api/projects/:projectId/stats`, `/production`, `/schedule` | Production overview: statistics, sequences × departments and what is late, calendar/Gantt |
| `/api/sequences`, `/api/shots` | Shot hierarchy, per-level pipeline overrides, `GET /shots/:id/tree`, permalink `GET /shots/:id/latest` |
| `/api/assets` | Assets CRUD |
| `/api/{sequences\|shots\|assets}/:id/thumbnail` | Entity thumbnail: `POST …/presign` then `PUT` the key (managers) |
| `/api/{projects\|sequences\|shots\|assets\|users}/…/departments` | Departments an entity goes through |
| `/api/departments` | Department reference — studio-wide, or per project; `PUT /departments/order` |
| `/api/tasks` | Tasks CRUD, statuses, assignment; `GET /tasks/board?projectId=` returns a whole kanban in one request |
| `/api/versions` | Versions, publication (publish lock), `POST /:id/decision`, `GET /:id/decisions`, restore and purge |
| `/api/review-statuses` | Studio review statuses (approval circuit) |
| `/api/pipeline-statuses` | Task/shot pipeline statuses |
| `/api/context` | `GET /:entity/:id` — breadcrumb and surrounding context for any entity |

## Media

`/api/media` is served by six routers; they share the prefix and are listed here by the
paths they own.

| Route | Domain |
|-------|--------|
| `POST /api/media/upload-url` | Simple presigned PUT upload (small files) |
| `POST /api/media/multipart/{init,:id/parts,:id/complete,:id/abort}` | Resumable multipart upload (16 MiB parts) |
| `POST /api/media/:id/finalize` | Close an upload: magic-byte check, quotas, enqueue processing |
| `GET /api/media`, `/reviews`, `/drafts`, `/:id`, `/:id/url` | Listing, review feed, drafts, detail, presigned read URL |
| `POST /api/media/:id/publish`, `/reprocess`, `/thumbnail`, `/auto-thumbnail` | Publish, retry a failed job, set a thumbnail |
| `GET /api/media/:id/hls/:file` | HLS manifests and segments |
| `DELETE /api/media/:id`, `POST /:id/restore`, `DELETE /:id/purge` | Trash, restore, permanent purge |
| `POST /api/media/:id/trim` | Non-destructive video trim (pre-publish) |
| `…/:id/splat-edits`, `/splat-mask`, `/splat-subset`, `/splat-presentation` | Splat edits, masks, staging |
| `…/:id/usd/recompose`, `/usd/override` | USD variant recomposition and ReView override layer |
| `…/:id/markers` (+ `/:markerId`) | Shared timeline markers |
| `POST /api/media/:id/references`, `DELETE …/references/:refId` | Review reference images |

There is **no `/api/media-reference` prefix**: reference images live under
`/api/media/:id/references`.

## Collaboration

| Prefix | Domain |
|--------|--------|
| `/api/comments` | Comments & annotations (threads, resolution, mentions, reactions, voice-note attachments, comment→task) |
| `/api/chat` | Internal messaging: `conversations`, messages, members, `unread` |
| `/api/boards` | Excalidraw boards (project/asset) |
| `/api/playlists` | Dailies playlists (ordered versions per project, chained playback); `GET /playlists/candidates?projectId=` searches the versions to add |
| `/api/live` | Ongoing live review sessions per project (LIVE badges) |
| `/api/timelines` | Auto-cut timelines: snapshots, comments, export |
| `/api/watch` | Notification subscriptions (watch/unwatch shot, asset or version) |
| `/api/notifications`, `/api/push` | Notifications; Web Push subscription (`GET /push/key`) |
| `/api/announcements` | Studio announcements |
| `/api/favorites` | Favorites |
| `/api/search` | Multi-entity search (Ctrl+K) |
| `/api/dashboard` | Home dashboard aggregates |
| `/api/bulk` | Multi-selection bulk operations |

## Sharing

| Prefix | Domain |
|--------|--------|
| `/api/share` | Share links: create, list, revoke (supervisor+) |
| `/api/client` | Public client access via share token: `GET /:token`, `POST /:token/unlock`, `GET /:token/media/:id/url`, media comments |

## Administration

| Prefix | Domain |
|--------|--------|
| `/api/admin` | `project-defaults`, `transcode`, `burnin`, `derived-purge` (+ `/run`), `oidc` (+ `oidc/logo/presign`), `api-tokens`, `media-access`, `dashboard`, `stats`, `system`, `trash` |
| `/api/admin` (content explorer) | `users/:id`, `projects`, `projects/:id`, `versions`, `comments`, `storage`, `DELETE /sessions/:sid` |
| `/api/admin/webhooks` | Outgoing webhooks (create, update, delete, `POST /:id/test`) |
| `/api/admin/service-tokens` | Machine identities for the v1 API (admin only) |
| `/api/admin/jobs` | BullMQ dashboard: `GET /`, `POST /:queue/:id/retry`, `POST /:queue/clean-failed` — `queue` is one of `media`, `storage-cleanup`, `webhooks` |

## Integrations

| Prefix | Domain |
|--------|--------|
| `/api/shotgrid` | ShotGrid connection config, sync, entity mapping, crew — see [ShotGrid integration](../admin-guide/shotgrid-integration.md) |
| `/api/shotgrid/webhook` | ShotGrid webhook receiver. Mounted **before** the JSON body parser: the HMAC signature covers the raw bytes |
| `/api/v1` | Pipeline integration surface — see [v1-integration.md](v1-integration.md) |
| `/api/docs`, `/api/openapi.json` | This API's interactive reference |

## Related pages

- [API overview](overview.md)
- [Authentication & API access](authentication.md)
- [API v1 — pipeline integration](v1-integration.md)
