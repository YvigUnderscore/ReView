# Users & roles

> Updated: 2026-08-21

ReView has **two layers of authorisation** and confusing them is the most common
administration mistake:

1. a **global role** carried by the account (`User.role`);
2. an optional **project role** carried by a membership (`ProjectMembership.role`),
   which overrides the global role *for that project only*.

Both are the enum `Role`: `ADMIN`, `SUPERVISOR`, `ARTIST`, `CLIENT`. There is no
"inactive" flag on an account — see
[Offboarding](#use-case-removing-a-contractor-at-the-end-of-a-contract).

## How the effective role is computed

`effectiveProjectRole(userId, globalRole, projectId)` resolves, in this order:

- global `ADMIN` → `ADMIN` everywhere, membership ignored;
- global `SUPERVISOR` → `SUPERVISOR` everywhere, membership ignored;
- otherwise: **no membership → no access at all** (`null`); with a membership, the
  effective role is `membership.role ?? globalRole`.

Two consequences worth memorising:

- **A global manager is never demoted by a project role.** Setting an admin's
  membership to `CLIENT` on a project changes nothing — they remain `ADMIN` there.
  Project roles cannot be used to hide a project from an admin or a supervisor.
- **A project role never leaks across projects.** An `ARTIST` whose membership on
  *Ligne Bleue* says `SUPERVISOR` is a supervisor on *Ligne Bleue* and an ordinary
  artist everywhere else.

## Global roles

| Role | Scope |
|------|-------|
| `ADMIN` | The only role that can open `/admin`. Every `/api/admin/*` route is `ADMIN`-only. Exempt from the per-user storage quota. |
| `SUPERVISOR` | Studio-wide **content** manager: sees and manages every project without being a member, creates projects, archives them, creates share links, manages pipeline structure. **No admin area.** |
| `ARTIST` | Contributes to the projects they are a member of: uploads versions, comments, annotates, moves tasks. |
| `CLIENT` | External reviewer. Read and comment on the projects they are a member of; no upload, no task creation. Also sees a reduced directory (see below). |

### What `CLIENT` cannot see

The `CLIENT` role is not just "fewer buttons" — the server narrows the data:

- **Directory / presence** (`GET /api/users/presence`) is filtered to people who share
  at least one project with the client. Other roles see the whole studio.
- **Member profiles** (`GET /api/users/:id/profile`) hide `email` and `phone` from a
  `CLIENT` viewer, and the listed projects are only those the two people share.
- **Upload and task creation** raise `403 ROLE_FORBIDDEN` (`assertCanContribute`).
- **Playlists** require `ADMIN`, `SUPERVISOR` or `ARTIST` — a client cannot create one.

### The subtle case: the *project* supervisor

A project supervisor is an account whose **global role is `ARTIST`** (or `CLIENT`)
but whose **membership on one project carries `SUPERVISOR`**. This is the intended
way to let a lead run their own show without handing them studio-wide powers.

What a project supervisor **can** do on that project (routes guarded by
`requireProjectManage`, which uses the effective role):

- add and remove members, and set their project role;
- edit the project settings (`PUT /api/projects/:projectId/settings`): departments,
  nomenclature, delivery resolution/framerate, upload naming rule, burn-in override,
  default 3D lighting, colour intent;
- run the CSV import (`POST /api/projects/:projectId/import-csv`);
- edit the ShotGrid connection of that project, and invite crew who **already have an
  account**.

What a project supervisor **cannot** do, because those routes require a *global*
`ADMIN`/`SUPERVISOR` (`requireRole`):

| Action | Route |
|--------|-------|
| Create, rename, archive, delete, restore or purge the project | `POST`/`PATCH`/`DELETE /api/projects…` |
| Set the project storage quota | `PATCH /api/projects/:projectId` (`storageQuota`) |
| Read the project trash | `GET /api/projects/:projectId/trash` |
| Duplicate the project | `POST /api/projects/:projectId/duplicate` |
| Create sequences, shots or assets | `POST /api/sequences`, `/api/shots`, `/api/assets` |
| Create, list or revoke **client share links** | `/api/shares…` |
| Manage departments through the department routes | `/api/departments…` |
| Set an entity thumbnail | `/api/…/thumbnail` |

The department case is worth a note: the dedicated department routes are global-role
only, but the project settings endpoint accepts a `departments` array and syncs it to
the `Department` table (`DepartmentService.syncFromSettings`). A project supervisor
can therefore reorder the pipe from *Project → Settings*, but not from the department
routes an integration would call.

### Creating accounts is a global privilege

**Only a global `ADMIN` can create an account** through the admin area:
`POST /api/users` is guarded by `requireRole(Role.ADMIN)`. The same applies to
`PATCH /api/users/:id`, `PATCH /api/users/:id/role`, `POST /api/users/:id/invite`,
`DELETE /api/users/:id` and `DELETE /api/users/:id/sessions`. A global `SUPERVISOR`
can only *list* accounts (`GET /api/users`).

There is exactly one other path that mints accounts — the ShotGrid crew invitation —
and it is gated by `canCreateStudioAccounts()`, which accepts a **global `ADMIN` or a
global `SUPERVISOR` and nobody else**. A project supervisor may run the invitation
(they manage the project), but the helper returns `false` for them: existing accounts
are added as members, unknown people are reported as not invitable. This is
deliberate — an integration screen must not become a side door to account creation.
See [ShotGrid integration](shotgrid-integration.md).

## Managing accounts — *Admin → Content → Users*

From `/admin/users` an administrator can:

- search (name, username, email), filter by role, sort the list;
- **create an account** with or without a password:
  - **with** a password (min 8 characters, at least one letter and one digit): the
    account is usable immediately;
  - **without** a password: the account is created with a random 32-byte secret that
    nobody — not even the creating administrator — ever sees, and an invitation email
    is sent. The server checks that a mail relay and a public URL are configured
    *before* creating the row, and **deletes the freshly created account** if the mail
    fails to leave, so a broken relay never leaves a silent account squatting an email
    address. Accounts still awaiting activation are flagged `invitePending` in the list.
- open the per-user **detail page** (`/admin/users/<id>`) — see
  [Content explorer](content-explorer.md#users--list-and-detail-page);
- set a **per-user storage limit** (`storageLimit`, bytes; empty falls back to the
  studio default `storage_limit_user`, 10 GB);
- change the role, reset the password or change the login email;
- delete the account.

Users edit their own name, username, job title, bio, phone, avatar and manual
presence status (Available / Away / Do not disturb) from `/profile`.

### Side effects you should expect

These are automatic and not obvious from the UI:

| Action | Automatic consequence |
|--------|----------------------|
| Admin changes a user's **password**, **email** or **role** | *All* of that user's sessions **and** all their API tokens are revoked (`revokeAllCredentials`). |
| User changes their own password or email | All their other sessions and all their API tokens are revoked; the current session is kept. |
| Admin changes a role | The 30-second identity cache is invalidated immediately, so the new role applies at once. |
| Admin **deletes** an account | All share links that account created are **revoked**, then the account row is hard-deleted. |

Note the last line: **deleting a user is not a soft delete.** There is no trash entry
for accounts and no undo. Comments, versions and media authored by the account are
affected by the database's own referential rules; if you need the history to stay
attributable, demote the account instead of deleting it.

## Authentication

- Email + password, JWT session: an **access token** (`JWT_EXPIRES_IN`, default `7d`)
  and a **refresh token** (`JWT_REFRESH_EXPIRES_IN`, default `30d`). Each login
  creates a revocable `UserSession` whose id is embedded in both tokens, so revoking
  the session kills both.
- Session validity and the account's identity are cached in-process for **30 seconds**.
  A revocation or a role change is therefore effective in ≤ 30 s — immediately when
  the write path invalidates the cache, which every account write does.
- Optional **TOTP two-factor** per account, with single-use backup codes; the secret
  is stored encrypted (AES-GCM). The intermediate 2FA token lives 5 minutes.
- Password rules are enforced server-side: 8–128 characters, at least one letter and
  one digit. Usernames are 2–40 characters, `A-Z a-z 0-9 . _ -`.
- **An API token can never change a password or a login email** — those two fields
  require a real interactive session (`403 API_TOKEN_FORBIDDEN`). Otherwise a token
  leaked in a CI log would be a full account takeover, 2FA included.

Single sign-on, the SSO-only switch and its lockout guards are documented in
[Identity, API & audit](identity-and-api.md).

## Per-project roles — *Project → Members*

Each membership can override the global role:

- **Global role** (default) — inherit the studio-wide role;
- **Supervisor** — local elevation, described above;
- **Artist** — contribute;
- **Client** — read and comment only.

Setting a project role to `CLIENT` is the standard way to bring an external reviewer
into one project. Setting it to `SUPERVISOR` is the standard way to appoint a lead.
Both are reversible at any time and take effect on the next request.

---

## Use case: opening one project to a client

*A client must review one project and must not learn that the other twelve exist.*

There are two mechanisms; pick according to whether the person needs an account.

**With an account (they will come back, comment, and be mentioned).**

1. *Admin → Users → New account*, role **`CLIENT`**, no password → an invitation is
   emailed and they choose their own password.
2. *Project → Members → Add*, select the account. Leave the project role on
   *Global role*, or set it explicitly to **Client**.
3. Done. The client sees exactly one project. Because non-manager roles have **no
   access without a membership**, every other project is invisible — not merely
   filtered out of a list, but refused server-side. Their directory is narrowed to
   people they share that project with, and they see neither emails nor phone numbers.

Do **not** give them the global role `ARTIST` "to keep it simple": that would let them
upload into any project they are later added to, and would expose the full studio
directory including email addresses.

**Without an account (a one-off delivery).** Create a share link instead — password,
expiry and view limit included. Note that creating a share link requires a **global**
`ADMIN` or `SUPERVISOR`; a project supervisor cannot do it. See
[Secure distribution](secure-distribution.md) and
[Sharing with clients](../user-guide/sharing.md).

## Use case: onboarding a three-week freelancer

*A compositor joins for a single sequence and leaves at the end of the month.*

1. *Admin → Users → New account*, role **`ARTIST`**, **no password** — the invitation
   flow means you never handle their password, and the account cannot be used until
   they claim it.
2. If their footage is heavy, raise their per-user storage limit on the account
   (`storageLimit`). Otherwise they inherit the studio default of 10 GB and will hit
   `403 STORAGE_LIMIT` mid-upload.
3. *Project → Members → Add*, project role left on *Global role*.
4. Optionally assign their departments (*Compositing*) so the "my department" filters
   and suggested assignments work.
5. Write the end date in your own calendar **now** — nothing in ReView expires a
   membership automatically.

At the end of the contract, follow the offboarding below. If they might come back,
prefer removing the membership over deleting the account: their comments and versions
keep a named author.

## Use case: removing a contractor at the end of a contract

*Access must stop today; the history must stay readable.*

There is **no "disable account" switch**. `UserStatus` (Available / Away / Do not
disturb) is presence, not access. Use this sequence:

1. **Remove the memberships** (*Project → Members → remove*) — for a non-manager role
   this alone cuts all project access, since access requires a membership.
2. **Demote the global role to `CLIENT`** if the account had `ARTIST`, `SUPERVISOR` or
   `ADMIN`. The role change itself revokes every session and every API token of that
   account, immediately.
3. **Check their share links.** Links they created keep working until revoked.
   Deleting the account revokes them automatically; demoting does not. Review them in
   the project's share list.
4. If you did not change the role, revoke access explicitly:
   `DELETE /api/users/:id/sessions` (all sessions, effective in ≤ 30 s) **and** revoke
   their tokens in *Admin → API & Webhooks* — that route revokes sessions only, not
   tokens.
5. Only delete the account if you are certain: it is a hard delete with no trash entry.

If the person held a **service token** for a render farm, revoking the token is
enough; the service account behind it stays so past writes keep an author. See
[Identity, API & audit](identity-and-api.md#service-tokens--machine-identities).

## Use case: appointing a lead without giving them the studio

*A senior artist should run one show end to end.*

Set their **membership** on that project to **Supervisor** and leave the global role at
`ARTIST`. They can then run members, settings, departments, the naming convention and
the CSV import for that project, and nothing at all elsewhere.

Plan for what they still cannot do: archiving the project, setting its storage quota,
duplicating it, creating sequences/shots/assets and issuing client share links all
need a global manager. If those are part of the job, the answer is the global
`SUPERVISOR` role — which grants them across **every** project — not a project role.
There is no middle ground today.

## Related pages

- [Project organization & per-project rights](project-organization.md)
- [Content explorer](content-explorer.md)
- [Identity, API & audit](identity-and-api.md)
- [Sharing with clients](../user-guide/sharing.md)
- [Security model](../infrastructure/security.md)
