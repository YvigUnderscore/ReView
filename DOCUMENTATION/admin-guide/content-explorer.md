# Content explorer (users, projects, versions, comments)

> Updated: 2026-08-02

The **Contenus** group of the admin area turns the former counters into full,
dedicated pages. Every page is addressable (`/admin/users`, `/admin/projects`,
`/admin/versions`, `/admin/comments`, `/admin/storage`) and the dashboard metric
cards link straight into them.

## Users — list and detail page

*Admin → Utilisateurs* (`/admin/users`) now offers full-text search (name,
username, email), a role filter and sorting (name, role, storage, most recent).
Clicking a user opens their **detail page** (`/admin/users/<id>`), which shows:

- **Profile**: display name, role badge, online indicator, 2FA badge, email,
  job title, phone, sign-up date, last activity.
- **Metrics**: storage used vs quota, uploaded media, authored versions,
  comments, assigned tasks.
- **Projects**: every membership with the effective role (project override or
  global role) and the join date; each project links to its own admin page.
- **Active sessions**: user agent, IP, last seen — an admin can revoke a single
  session (`DELETE /api/admin/sessions/:sid`) or all of them at once.
- **API tokens**: active personal tokens (name, scopes, last use, expiry).
  Revocation stays in *API & Webhooks*.
- **Recent activity**: the user's last audit-log entries, linked to the
  affected entities when possible.
- **Actions**: edit the account (same modal as the list) or delete it.

## Projects — list and detail page

*Admin → Projets* (`/admin/projects`) lists **all** projects of the instance
(admins see everything, regardless of membership) with search and status
filter. Each row shows member/sequence/shot/asset/version/media counters and
storage consumption against the project quota (percentage highlighted when
above 90%). Deleted projects live in *Maintenance → Corbeille*.

The **detail page** (`/admin/projects/<id>`) provides:

- header with status, slug, timestamps and a direct link to the regular
  project page;
- metrics: storage vs quota, versions, media (count + bytes), comments,
  assets — versions and comments link to the global lists pre-filtered on the
  project;
- **members table** with avatar, effective role (override badge) and join
  date, each linking to the user detail page;
- **resolved settings**: the effective pipeline (resolution/framerate), start
  frame, nomenclature, departments and upload-naming rule after the
  studio → project inheritance;
- **hierarchy browser**: sequences and their shots (plus "shots without
  sequence"), each level showing its **effective pipeline settings** after the
  project → sequence → shot inheritance, with an `override` badge whenever a
  level redefines resolution or framerate — and an explicit "hérité" tag
  otherwise.

## Versions — global list

*Admin → Versions* (`/admin/versions`) lists every version of the studio with
server-side pagination and filters: project, version status (`DRAFT`,
`REVIEW`, `PUBLISHED`), publication state, media kind (video, image, 3D,
splat) and name search. Each row shows the human-readable location
(`SQ010 · SH020 › anim`), the current review decision (colored status), the
publication badge, media count/kinds, author and creation date. The version
name links to the review page of its first media.

The backing endpoint is `GET /api/admin/versions` (admin only, Zod-validated
query, paginated envelope `{ items, total, page, pageSize }`).

## Comments — search and moderation

*Admin → Commentaires* (`/admin/comments`) is the moderation view over every
review comment: full-text search on the content, filters by project, author
and resolution state, pagination. Each entry shows the author (or guest name),
reply badge, resolution state, the media it belongs to (linked to the review)
and the video timestamp when set.

Moderation actions reuse the standard comment endpoints:

- **resolve / reopen** — `PATCH /api/comments/:id` (`isResolved`);
- **delete** — `DELETE /api/comments/:id` (removes replies too, after
  confirmation).

`GET /api/admin/comments` is admin-only and read-only.

## Related pages

- [Users & roles](users-and-roles.md)
- [Storage map](storage.md)
- [Pipeline settings](pipeline-settings.md)
- [Project organization & per-project rights](project-organization.md)
