# System & maintenance

> Updated: 2026-08-21

Four `ADMIN`-only screens: *Studio → System*, *Studio → Settings*, and
*Maintenance → Jobs / Trash / Audit*.

## System — *Admin → Studio → System*

`GET /api/admin/system` reports the **runtime state of the instance**, not its
settings:

- **host** — platform, architecture, Node version, CPU count, load average (always
  `[0,0,0]` on Windows), host and process uptime;
- **memory** — total, free, used, process RSS;
- **disk** — total and free bytes of the volume holding the server's working
  directory, when the OS supports `statfs`;
- **service health** — database, Redis and MinIO, each probed live. This is the first
  place to look when uploads or jobs stop working;
- **licence** — AGPL-3.0-or-later, the third-party notices file, and whether the
  studio has published its corresponding source URL (see below).

Studio *limits* are not here — they are in *Settings*.

## Settings — *Admin → Studio → Settings*

Key/value studio settings (`GET`/`PUT /api/studio/settings`, `ADMIN` only, audit
action `SETTING_UPDATE`). Every write is a single `{ key, value }` upsert.

| Setting | Key | Default | What it does |
|---------|-----|---------|--------------|
| Default start frame | `default_start_frame` | **1001** | Start frame given to new projects |
| Maximum file size | `max_file_size` | **5 GB** | One global ceiling; an upload above it is refused with `400 FILE_TOO_LARGE` |
| Default user storage quota | `storage_limit_user` | **10 GB** | Applies to accounts with no `storageLimit` of their own; **administrators are exempt** |
| Concurrent uploads | `max_concurrent_uploads` | **5** | Per uploader; beyond it, `429 TOO_MANY_UPLOADS` |
| Trash retention | `trash_retention_days` | **30** | Days before automatic permanent purge; `0` disables it |
| Live sync rate — video / image / 3D / splat | `live_sync_hz_video` (2), `live_sync_hz_image` (4), `live_sync_hz_3d` (10), `live_sync_hz_splat` (10) | see keys | Broadcasts per second from the driver in a live review room; clamped 1–30 |
| Slack webhook | `slack_webhook_url` | empty | See [Branding & notifications](branding-and-notifications.md) |
| Source code URL | `studio_source_url` | upstream repository | AGPL §13 obligation, see below |
| Studio language | `studio_default_locale` | `en` | Language for accounts that never chose one, and for every server-rendered email |
| Accent colour | `studio_accent` | `#00b3c4` | See [Branding & notifications](branding-and-notifications.md) |

Size fields are entered in MB or GB and stored in **bytes**. There is **one**
`max_file_size` for the whole instance — it is not per media kind.

Two keys are **never readable and never writable through this screen**:
`smtp_config` and `vapid_keys`. They hold secrets (the encrypted SMTP configuration
and the private VAPID key that signs every push notification of the instance) and have
their own endpoints; a `PUT` naming one is refused with `400 RESERVED_SETTING`.

### Source code URL (AGPL §13)

ReView is distributed under AGPL-3.0-or-later. If you deploy a **modified** version,
§13 requires offering the corresponding source to every remote user, including
unauthenticated ones. `studio_source_url` is where you point at *your* sources; it is
served with the public branding and shown on the login page and the client share page.
Only `http`/`https` values are accepted — anything else silently falls back to the
upstream repository, which would not satisfy the obligation for a modified build.

## Trash and automatic retention

Deletions across the app are **soft deletes**. Deleted projects appear in
*Admin → Maintenance → Trash* (`GET /api/admin/trash`) where they can be restored or
purged. Deleted sequences, shots, assets, versions and media appear in the **project's
own** trash (`GET /api/projects/:projectId/trash`, global `ADMIN`/`SUPERVISOR`).

Purging is permanent: database rows **and** MinIO objects. Purging a project requires
`ADMIN`.

> **The trash empties itself.** A sweep runs 60 seconds after the server starts and
> then every 24 hours. It permanently purges everything soft-deleted for longer than
> `trash_retention_days` — **30 days by default** — media first, then versions, shots,
> sequences, assets and projects. There is no confirmation, no notification, and no
> audit entry. If your studio expects the trash to be an archive, set
> `trash_retention_days` to `0` (disables the sweep entirely) *before* someone
> discovers the default the hard way.

The same sweep also purges the API v1 event log and expired idempotency keys, which
are buffers rather than archives, and runs the derived-files purge below.

## Jobs — *Admin → Maintenance → Jobs*

`GET /api/admin/jobs` (`ADMIN`) shows the three BullMQ queues — **`media`**,
**`storage-cleanup`** and **`webhooks`** — each with counts (waiting, active,
completed, failed, delayed) and the recent failed, active and waiting jobs including
`failedReason` and `attemptsMade`.

Actions:

- **Retry a failed job** — `POST /api/admin/jobs/:queue/:id/retry`; refuses anything
  that is not in the failed state. Audit `JOB_RETRY`.
- **Clean the failed list** of a queue — `POST /api/admin/jobs/:queue/clean-failed`,
  up to 1000 entries. This discards the job records; it does not fix the media.
  Audit `JOBS_CLEAN_FAILED`.
- **Retry every failed media job** — `POST /api/admin/jobs/retry`. Audit `JOBS_RETRY`.

### Derived files purge

Same screen, separate feature (`GET`/`PUT /api/admin/derived-purge`,
`POST /api/admin/derived-purge/run`, `ADMIN`; audit `DERIVED_PURGE_CONFIG` and
`DERIVED_PURGE_RUN`).

| Field | Default | Range |
|-------|---------|-------|
| `enabled` | **`false`** | boolean |
| `keepVersions` | **3** | 1–100 |

When enabled, for each task and each asset it keeps the newest `keepVersions`
versions intact and, on the **video** media of the older ones, deletes the whole
`derived/{mediaId}/hls/` prefix and the timeline sprite, then marks
`metadata.hlsPurged = true`.

- **Kept:** the MP4 proxy and the thumbnail — old versions stay watchable at proxy
  quality, with a working card.
- **Lost:** adaptive quality selection and the timeline hover preview on those media.
- The MinIO deletions are permanent. Regenerating them means reprocessing the media,
  which is refused on published versions (`403 PUBLISHED_LOCKED`) and in any case
  usually impossible because the original has been superseded.
- It is idempotent, and runs automatically inside the daily sweep once enabled.

Enable it deliberately, not experimentally: it is the one maintenance switch that
silently deletes data across the whole instance the first time the sweep runs.

## Audit — *Admin → Maintenance → Audit*

`GET /api/studio/audit` (`ADMIN`, paginated, newest first) records sensitive actions
with the author, timestamp, entity type and entity id. The recorded actions cover:

- accounts and access — `USER_CREATE`, `USER_UPDATE`, `USER_ROLE_CHANGE`,
  `USER_INVITE`, `USER_DELETE`, `SESSION_REVOKE`, `SESSION_REVOKE_ALL`,
  `TWOFA_ENABLE`, `TWOFA_DISABLE`, `TWOFA_FAIL`, `TWOFA_BACKUP_USED`,
  `OIDC_LOGIN`, `OIDC_PROVISION`, `OIDC_CONFIG_UPDATE`;
- API surface — `API_TOKEN_CREATE`, `API_TOKEN_REVOKE`, `WEBHOOK_CREATE`,
  `WEBHOOK_UPDATE`, `WEBHOOK_DELETE`;
- distribution — `SHARE_CREATE`, `SHARE_REVOKE`, `SHARE_VIEW`, `SHARE_UNLOCK_FAIL`;
- content — `PROJECT_CREATE`, `PROJECT_SETTINGS_UPDATE`, `PROJECT_DUPLICATE`,
  `PROJECT_IMPORT_CSV`, `PROJECT_DELETE`, `PROJECT_RESTORE`, `PROJECT_PURGE`,
  `VERSION_PUBLISH`, `VERSION_DELETE`, `VERSION_PURGE`, `MEDIA_DELETE`,
  `MEDIA_PURGE`, `MEDIA_REPROCESS`, `MEDIA_DEDUP`, `MEDIA_QUARANTINED`,
  `SHOT_BULK_MOVE`;
- configuration — `SETTING_UPDATE`, `STUDIO_UPDATE`, `SMTP_UPDATE`,
  `TRANSCODE_CONFIG_UPDATE`, `BURNIN_CONFIG_UPDATE`, `PROJECT_DEFAULTS_UPDATE`,
  `DERIVED_PURGE_CONFIG`, `DERIVED_PURGE_RUN`, `HDRI_ADD`, `HDRI_DELETE`,
  `OCIO_INSTALL`, `OCIO_DEFAULT`, `OCIO_DELETE`, `ANNOUNCEMENT_*`, `JOB_RETRY`,
  `JOBS_RETRY`, `JOBS_CLEAN_FAILED`.

Two limits to know:

- The entry's **`metadata` is deliberately not returned** by the API. Secrets pass
  through configuration changes — the Discord webhook URL, for instance, is recorded
  only as "changed" — and a readable audit log must not become the new hiding place
  for them. What you get is who, when, what action, on which entity.
- Audit writes are **best effort**: a failure is logged and never fails the user's
  request. The log is a traceability baseline, not a transactional ledger.
- The audit table has **no retention policy** — it is never purged automatically.

## Activity — *Admin → Studio → Activity*

The recent activity feed across projects: who uploaded, published or commented what,
and when. Unlike the audit log this is a product feed, not a security record.

---

## Use case: preparing the first week of a new instance

*The stack is up and the first show is about to land.*

1. *System*: confirm database, Redis and MinIO are all green. A red MinIO here
   explains every upload failure you are about to get.
2. *Settings*: set `max_file_size` to something the studio actually produces — 5 GB
   refuses a lot of EXR sequences and plate pulls, and the artist only finds out at
   the end of the upload.
3. *Settings*: raise `storage_limit_user` or set per-account limits. 10 GB is a
   demo-sized default; a single compositor exceeds it in a week.
4. *Settings*: **decide `trash_retention_days` now.** Leaving it at 30 means anything
   deleted today is unrecoverable in a month, silently.
5. *Settings*: fill `studio_source_url` if you modified the code — it is a licence
   obligation, not a nicety.
6. *Jobs*: leave the derived purge **off** until the studio has a real version
   history; with `keepVersions: 3` on a brand-new project it would purge almost
   nothing, and on an imported back catalogue it would purge a great deal.

## Use case: the monthly maintenance pass

1. *System* — service health and free disk. Free disk trending down faster than the
   bucket grows means something outside MinIO is filling the volume.
2. *Jobs* — clear the failed lists after checking why they failed. A queue with
   hundreds of failures is a signal, not a housekeeping chore.
3. *Content → Storage* — re-scan, look at the category split and the heaviest
   projects. See [Storage map](storage.md#use-case-reclaiming-space-when-the-bucket-fills-up).
4. *Maintenance → Trash* — anything you actually want to keep must be **restored**
   before the retention window closes; the sweep will not ask.
5. *Audit* — scan for `SHARE_CREATE` you do not recognise, `USER_ROLE_CHANGE` you did
   not make, and `SHARE_UNLOCK_FAIL` bursts (someone guessing a share password).
6. *Media access* — see
   [Identity, API & audit](identity-and-api.md#media-access-log--admin--maintenance--media-access).

## Related pages

- [Storage map](storage.md)
- [Transcoding](transcoding.md)
- [Identity, API & audit](identity-and-api.md)
- [Security model](../infrastructure/security.md)
- [Monitoring](../infrastructure/monitoring.md)
