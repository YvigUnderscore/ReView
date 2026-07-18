# Sharing with clients

> Updated: 2026-07-18

Supervisors and admins can create **share links** to give external clients access
to a project's published media without an account.

## Share links

- Created per project (`Admin`/`Supervisor` only), each link carries:
  - a **permission**: `VIEW` (watch only) or `COMMENT` (watch + comment);
  - an optional **expiry** (days); links can be **revoked** at any time.
- The link token is the only credential — treat it like a password.

## What clients see

- Only **published** media of **published** versions with processing `READY`.
- Drafts, locked content and admin surfaces are never exposed.
- With `COMMENT` permission, client feedback lands in the same comment threads the
  team uses.

## Auditing

Share link creation and revocation are recorded in the audit log
(*Admin → Maintenance → Audit*).

## Related pages

- [Users & roles (admin)](../admin-guide/users-and-roles.md)
- [Upload & publishing](upload-and-publishing.md)
