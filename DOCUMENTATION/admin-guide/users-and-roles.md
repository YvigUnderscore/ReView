# Users & roles

> Updated: 2026-08-02

## Roles

| Role | Capabilities |
|------|--------------|
| `ADMIN` | Everything, including the admin area and studio settings |
| `SUPERVISOR` | Project supervision: manage project content, review, share links |
| `ARTIST` | Work on assigned projects: upload versions, comment, review |
| `CLIENT` | Restricted external profile: view/comment on what is shared with them |

Access to content is always filtered by **project membership** server-side; a role
grants capabilities *within* the projects the user belongs to.

## Managing users

From *Admin → Utilisateurs*:

- search (name, username, email), filter by role and sort the account list;
- create accounts (name, email, role) and edit them;
- open a user's **detail page** (projects & roles, active sessions with
  per-session revocation, API tokens, recent audit activity, contribution
  counters) — see [Content explorer](content-explorer.md#users--list-and-detail-page);
- avatars and profile details are editable by the users themselves (`/profile`,
  including status Available/Away/DND);
- deactivate accounts you no longer want to allow in.

## Authentication

- Email + password, JWT session (access token + refresh token).
- Password rules and SMTP-based emails (invitations, resets) depend on the
  [SMTP configuration](smtp-and-announcements.md).

## Per-project roles

A member's global role can be overridden **per project** (local elevation to
supervisor, or restriction to client) without changing their studio-wide role —
see [Project organization & per-project rights](project-organization.md#per-project-roles).

## Related pages

- [Project organization & per-project rights](project-organization.md)
- [Sharing with clients](../user-guide/sharing.md)
- [Security model](../infrastructure/security.md)
