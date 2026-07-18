# Users & roles

> Updated: 2026-07-18

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

- create accounts (name, email, role) and edit them;
- avatars and profile details are editable by the users themselves (`/profile`,
  including status Available/Away/DND);
- deactivate accounts you no longer want to allow in.

## Authentication

- Email + password, JWT session (access token + refresh token).
- Password rules and SMTP-based emails (invitations, resets) depend on the
  [SMTP configuration](smtp-and-announcements.md).

## Related pages

- [Sharing with clients](../user-guide/sharing.md)
- [Security model](../infrastructure/security.md)
