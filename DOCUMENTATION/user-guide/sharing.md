# Sharing with clients

> Updated: 2026-07-19

Supervisors and admins can create **share links** to give external clients access
to a project's published media without an account. Links are managed in the
project's **Shares** tab and open a dedicated, distraction-free client page.

## Creating a hardened share link

Project page → **Shares** tab → **New link**. Each link carries:

- a **recipient label** — shown in the admin list and embedded in the on-screen
  watermark of the client page;
- a **permission**: `VIEW` (watch only) or `COMMENT` (watch + comment);
- an optional **password** (bcrypt-hashed, never displayed again);
- an optional **expiry** (days);
- an optional **view limit** (maximum number of viewing sessions).

The generated URL (`https://<studio>/client/<token>`) is copied to the clipboard on
creation. Links can be **revoked** at any time from the same tab; the list shows the
view counter (`views / limit`), last-viewed date and a lock icon for password links.

## How views are counted

Opening the client page starts a **share session** (24 h token). One session = one
view. The session is granted by the initial page load (or by a successful password
unlock) and is required by every subsequent request — the view limit and password
cannot be bypassed by calling media URLs directly. When the limit is reached, new
visitors get a clear "view limit reached" message; sessions already open keep
working.

## What clients see

The client page is intentionally minimal: studio logo/name, media grid, player and
comments — **no navigation into the app**.

- Only **published** media of **published** versions with processing `READY`.
- Video plays the review proxy — or the **client derivative with a 3-second slate**
  (project/shot/version/author identification card) when slates are enabled by the
  studio. Comment timestamps are automatically offset so they always refer to the
  media itself, slate excluded.
- A discreet **watermark** (recipient label + studio + date) is overlaid on the
  player when enabled (default for shares).
- With `COMMENT` permission, clients sign their comments with a free-form name;
  feedback lands in the same comment threads the team uses (marked
  "visible to client").

## Auditing

Share link creation, revocation, each counted view (`SHARE_VIEW`) and failed
password attempts (`SHARE_UNLOCK_FAIL`) are recorded in the audit log
(*Admin → Maintenance → Audit*). Password unlock attempts are rate-limited per
IP + link.

## Related pages

- [Secure distribution (admin)](../admin-guide/secure-distribution.md)
- [Users & roles (admin)](../admin-guide/users-and-roles.md)
- [Upload & publishing](upload-and-publishing.md)
