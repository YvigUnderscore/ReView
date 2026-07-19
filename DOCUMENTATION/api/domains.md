# API domains

> Updated: 2026-07-18

One router per domain (`backend/src/routes/*.routes.ts`). Full parameter-level
detail lives in the interactive reference at `/api/docs`.

| Prefix | Domain |
|--------|--------|
| `/api/auth` | Login, refresh, current user |
| `/api/setup` | First-run studio/admin creation (empty DB only) |
| `/api/users` | Profile, preferences, avatars |
| `/api/studio` | Studio settings |
| `/api/projects` | Projects CRUD, membership, settings |
| `/api/sequences`, `/api/shots` | Shot hierarchy, per-level pipeline overrides |
| `/api/assets` | Assets CRUD |
| `/api/tasks` | Tasks CRUD, statuses, assignment |
| `/api/versions` | Versions, publication (publish lock) |
| `/api/media` | Media objects, upload lifecycle, thumbnails |
| `/api/media/*/video` | Video-specific: HLS manifests, trim |
| `/api/media/*/splat` | Splat edits, masks, presentation |
| `/api/media-reference` | Reference images |
| `/api/comments` | Comments & annotations (threads, resolution, mentions, reactions, voice-note attachments, comment→task) |
| `/api/watch` | Notification subscriptions (watch/unwatch shot, asset or version) |
| `/api/playlists` | Dailies playlists (ordered versions per project, chained playback) |
| `/api/live` | Ongoing live review sessions per project (LIVE badges) |
| `/api/boards` | Excalidraw boards (project/asset) |
| `/api/documents` | Rich-text documents (Documents page) |
| `/api/dashboard` | Home dashboard aggregates |
| `/api/search` | Multi-entity search (Ctrl+K) |
| `/api/favorites` | Favorites |
| `/api/notifications` | Notifications |
| `/api/announcements` | Studio announcements |
| `/api/hdri` | HDRI library |
| `/api/share` | Share links (create/revoke, supervisor+) |
| `/api/client` | Public client access via share token |
| `/api/bulk` | Multi-selection bulk operations |
| `/api/admin` | Admin: users, system, settings, transcoding, trash, audit |
| `/api/docs`, `/api/openapi.json` | This API's interactive reference |

## Related pages

- [API overview](overview.md)
