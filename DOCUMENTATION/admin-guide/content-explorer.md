# Content explorer (users, projects, versions, comments)

> Updated: 2026-08-21

The **Content** group of the admin area turns the dashboard counters into full,
dedicated pages. Every page is addressable (`/admin/users`, `/admin/projects`,
`/admin/versions`, `/admin/comments`, `/admin/storage`) and the dashboard metric cards
link straight into them.

All of these pages are **`ADMIN`-only** and, except for session revocation,
**read-only**: write actions reuse the ordinary endpoints (users, comments), so they
obey the same rules and produce the same audit entries as they would elsewhere.

## Users — list and detail page

*Admin → Users* (`/admin/users`) offers full-text search (name, username, email), a
role filter and sorting (name, role, storage, most recent). Service accounts are
excluded from the list — they are write-carriers, not members of the studio. Accounts
that have been invited but never activated are flagged as pending.

Clicking a user opens their **detail page** (`/admin/users/<id>`,
`GET /api/admin/users/:id`), which shows:

- **Profile**: display name, role badge, online indicator, 2FA badge, email, job
  title, phone, sign-up date, last activity.
- **Metrics**: storage used against the account's limit, uploaded media, authored
  versions, comments, assigned tasks. The limit shown is the account's own
  `storageLimit` when set, otherwise the studio default (`storage_limit_user`, 10 GB).
- **Projects**: every membership with the **effective role** (project override or
  global role) and the join date; each project links to its own admin page.
- **Active sessions**: user agent, IP, last seen. An admin can revoke a single session
  (`DELETE /api/admin/sessions/:sid`) or all of them at once
  (`DELETE /api/users/:id/sessions`). Both take effect in ≤ 30 s. Neither revokes the
  account's **API tokens** — do that in *API & Webhooks*.
- **API tokens**: the account's active tokens (name, scopes, last use, expiry).
  Revocation stays in *API & Webhooks*.
- **Recent activity**: the user's last audit-log entries, linked to the affected
  entities where possible.
- **Actions**: edit the account (same modal as the list) or delete it. Deleting is a
  **hard delete** and also revokes every share link the account created — see
  [Users & roles](users-and-roles.md#side-effects-you-should-expect).

## Projects — list and detail page

*Admin → Projects* (`/admin/projects`, `GET /api/admin/projects`) lists **all**
non-deleted projects of the instance — admins see everything regardless of
membership — with search and a status filter. Each row shows member, sequence, shot,
asset, version and media counters plus storage consumption against the project quota;
the percentage is highlighted once it reaches **90 %**. Deleted projects are not here;
they live in *Maintenance → Trash*.

The **detail page** (`/admin/projects/<id>`) provides:

- header with status, slug, timestamps and a direct link to the regular project page;
- metrics: storage against quota, versions, media (count and bytes), comments,
  assets — versions and comments link to the global lists pre-filtered on the project;
- **members table** with avatar, effective role (with an override badge when the
  membership carries its own role) and join date, each linking to the user detail page;
- **resolved settings**: the effective pipeline (resolution, framerate), start frame,
  nomenclature, departments and upload-naming rule after studio → project inheritance;
- **hierarchy browser**: sequences and their shots (plus "shots without sequence"),
  each level showing its **effective pipeline settings** after the full
  project → sequence → shot resolution, with an `override` badge whenever a level
  redefines resolution or framerate and an explicit *inherited* tag otherwise.

That last panel is the authoritative answer to "what does this shot actually deliver
at" — see
[Pipeline settings](pipeline-settings.md#use-case-auditing-what-a-shot-really-inherits).

## Versions — global list

*Admin → Versions* (`/admin/versions`, `GET /api/admin/versions`) lists every version
of the studio with server-side pagination and filters: project, version status
(`DRAFT`, `REVIEW`, `PUBLISHED`), publication state, media kind (video, image, 3D,
splat) and name search. Each row shows the human-readable location
(`SQ010 · SH020 › anim`), the current review decision with its colour, the publication
badge, media count and kinds, author and creation date. The version name links to the
review page of its first media.

A version with **zero media** is a version whose upload never finalised — the most
common shape of "my file disappeared".

## Comments — search and moderation

*Admin → Comments* (`/admin/comments`, `GET /api/admin/comments`, read-only) is the
moderation view over every review comment: full-text search on the content, filters by
project, author and resolution state, pagination. Each entry shows the author (or the
guest name for a comment left through a share link), the reply badge, the resolution
state, the media it belongs to — linked to the review — and the video timestamp when
one is set.

Moderation actions reuse the standard comment endpoints:

- **resolve / reopen** — `PATCH /api/comments/:id` (`isResolved`);
- **delete** — `DELETE /api/comments/:id`, which removes replies too, after
  confirmation. There is no undo for a deleted comment.

## Storage

*Admin → Storage* is documented separately in [Storage map](storage.md).

---

## Use case: answering "who has access to this project?"

*A producer asks for the access list of a show before an external audit.*

1. *Admin → Projects → the project → Members*. The table shows the **effective role**
   per member, with a badge when it comes from a project override rather than the
   global role.
2. That list is not complete on its own. **Every global `ADMIN` and `SUPERVISOR` also
   has full access without appearing as a member.** Get that list from
   *Admin → Users* with the role filter, and add it to the answer.
3. Add the **share links** of the project: they grant access with no account at all.
   Check their expiry, view limit and whether they carry a password.
4. Add the **service tokens** bound to the project — they hold a membership and can
   write. `GET /api/admin/api-tokens` lists them alongside personal tokens.
5. For "who actually looked", not "who could", use
   *Maintenance → Media access* — one line per viewer per media, deduplicated over 30
   minutes, covering both accounts and share links.

## Use case: tracking down an account that is filling the disk

1. *Admin → Users*, sort by **storage**. The column is the total of everything that
   account has ever uploaded.
2. Open the account's detail page: the metrics panel shows usage against the limit in
   force, and the projects panel shows where they work.
3. Decide which lever applies. A per-account `storageLimit` caps that person
   everywhere and **does not apply to administrators**; a project quota caps the show
   and applies to everyone. See
   [Project organization](project-organization.md#storage-quota--usage).
4. If the weight is renditions rather than sources, neither lever helps — that is the
   derived purge's job. Cross-check in
   [Storage map](storage.md#use-case-reclaiming-space-when-the-bucket-fills-up).

## Use case: moderating a comment thread that went wrong

*A heated exchange on a shot needs to be cleaned up before the client sees it.*

1. *Admin → Comments*, search the content or filter by author and project. The
   moderation view spans the whole studio, so you do not need to know which media it
   was on.
2. Prefer **resolving** over deleting: the thread stops surfacing as open feedback but
   the history stays. Deleting removes the comment **and all its replies**, with no
   undo and no trash.
3. If the comment came through a share link, the author is a guest name, not an
   account — the corrective action is on the link (revoke it), not on a user.
4. Deletions are not recorded in the audit log as comment actions; if the exchange may
   matter later, screenshot or export before removing it.

## Related pages

- [Users & roles](users-and-roles.md)
- [Project organization & per-project rights](project-organization.md)
- [Pipeline settings](pipeline-settings.md)
- [Storage map](storage.md)
- [System & maintenance](system-and-maintenance.md)
