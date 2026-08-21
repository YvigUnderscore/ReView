# Admin overview

> Updated: 2026-08-21

The admin area lives at `/admin` and is **reserved to accounts whose global role is
`ADMIN`**. The restriction is enforced twice: the page itself refuses any other role,
and every `/api/admin/*` route is mounted behind `authenticate + requireRole(ADMIN)`.
A global `SUPERVISOR` therefore has no admin area at all — supervisors manage
*projects*, not the studio (see [Users & roles](users-and-roles.md)).

Each section is directly addressable (`/admin/<section>`), and two of them add an id
segment for their detail page (`/admin/users/<id>`, `/admin/projects/<id>`).

## Sections

| Group | Section | Path | Purpose |
|-------|---------|------|---------|
| Studio | Dashboard | `/admin/overview` | Studio metrics, linked to the detail pages |
| Studio | Activity | `/admin/activity` | Recent activity feed across projects |
| Studio | Identity (SSO) | `/admin/identity` | OIDC single sign-on, SSO-only switch — see [Identity, API & audit](identity-and-api.md) |
| Studio | Login page | `/admin/login-appearance` | Sign-in page background and wording |
| Studio | System | `/admin/system` | Host, memory, disk, service health, licence — see [System & maintenance](system-and-maintenance.md) |
| Studio | Settings | `/admin/settings` | Studio-wide limits, retention, default language, accent — see [System & maintenance](system-and-maintenance.md) and [Branding & notifications](branding-and-notifications.md) |
| Studio | Project defaults | `/admin/defaults` | Pipeline values inherited by every project — see [Pipeline settings](pipeline-settings.md) |
| Content | Users | `/admin/users` | Account list + per-user detail page — see [Content explorer](content-explorer.md) |
| Content | Projects | `/admin/projects` | All projects with counters/quotas + detail page — see [Content explorer](content-explorer.md) |
| Content | Versions | `/admin/versions` | Global filterable list of every version — see [Content explorer](content-explorer.md) |
| Content | Comments | `/admin/comments` | Studio-wide comment search & moderation — see [Content explorer](content-explorer.md) |
| Content | Storage | `/admin/storage` | MinIO occupancy + map of where each file type lives — see [Storage map](storage.md) |
| Review contexts | 3D & Splat | `/admin/hdri` | HDRI environment library — see [HDRI library](hdri-library.md) |
| Review contexts | Colour (OCIO) | `/admin/ocio` | Colour management configs — see [Colour management](color-management.md) |
| Review contexts | Video | `/admin/video` | HLS transcoding ladder — see [Transcoding](transcoding.md) |
| Review contexts | Delivery | `/admin/distribution` | Studio logo, viewer watermark, burn-ins & slates — see [Secure distribution](secure-distribution.md) |
| Review contexts | Statuses | `/admin/review-statuses` | Custom review decision statuses — see [Review decisions](../user-guide/review-approvals.md) |
| Communications | Announcements | `/admin/announcements` | Studio-wide announcements — see [SMTP & announcements](smtp-and-announcements.md) |
| Communications | SMTP | `/admin/smtp` | Outgoing mail configuration — see [SMTP & announcements](smtp-and-announcements.md) |
| Communications | API & Webhooks | `/admin/api` | Studio API tokens + outgoing webhooks — see [Identity, API & audit](identity-and-api.md) |
| Communications | ShotGrid | `/admin/shotgrid` | Studio-wide ShotGrid sites and credentials — see [ShotGrid integration](shotgrid-integration.md) |
| Maintenance | Jobs | `/admin/jobs` | BullMQ queues (retry, clean) + derived-files purge — see [System & maintenance](system-and-maintenance.md) |
| Maintenance | Trash | `/admin/trash` | Soft-deleted projects, restore/purge — see [System & maintenance](system-and-maintenance.md) |
| Maintenance | Audit | `/admin/audit` | Audit log of sensitive actions |
| Maintenance | Media access | `/admin/media-access` | Who viewed which media, when — see [Identity, API & audit](identity-and-api.md) |

An unknown `<section>` falls back to the dashboard rather than erroring.

## What is *not* in the admin area

Project-level organization is deliberately managed from each project, not from
`/admin`: archiving, duplication, storage quota, upload naming convention,
per-project roles, CSV import/export, departments, per-project burn-in overrides and
the project colour intent. Several of those still require a **global** manager role
even though they are reached from the project page — the split is documented in
[Project organization & per-project rights](project-organization.md).

## Reading order for a new administrator

1. [Users & roles](users-and-roles.md) — who can do what, and the two role layers.
2. [System & maintenance](system-and-maintenance.md) — the studio limits and the
   retention settings that silently delete data if left at their defaults.
3. [Pipeline settings](pipeline-settings.md) — the values every new project inherits.
4. [Transcoding](transcoding.md) and [Storage map](storage.md) — what the workers
   produce and where it lands.
5. [Secure distribution](secure-distribution.md) and
   [Identity, API & audit](identity-and-api.md) — everything that reaches outside
   the studio.

## Common administration tasks

| Situation | Where to go |
|-----------|-------------|
| A new artist starts on Monday | [Users & roles → onboarding](users-and-roles.md#use-case-onboarding-a-three-week-freelancer) |
| A contract ends today | [Users & roles → offboarding](users-and-roles.md#use-case-removing-a-contractor-at-the-end-of-a-contract) |
| A client must see one project and nothing else | [Users & roles → client scoping](users-and-roles.md#use-case-opening-one-project-to-a-client) |
| A new production starts | [Pipeline settings → new production](pipeline-settings.md#use-case-standing-up-the-pipe-for-a-new-production) |
| A medium is stuck in processing | [Transcoding → diagnosing](transcoding.md#use-case-diagnosing-a-medium-stuck-in-processing) |
| The bucket is filling up | [Storage map → reclaiming space](storage.md#use-case-reclaiming-space-when-the-bucket-fills-up) |
