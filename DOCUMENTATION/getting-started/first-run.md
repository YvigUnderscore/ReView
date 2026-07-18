# First run

> Updated: 2026-07-18

## Setup page

On an empty database, every route redirects to **`/setup`**. This one-time wizard
creates:

- the **studio** (name — one ReView instance hosts exactly one studio), and
- the first **administrator** account.

Once setup completes, the app switches to the normal login flow and `/setup` is no
longer accessible.

## Seed accounts (development)

The development seed (`backend/prisma/seed.ts`) is idempotent and creates a demo
studio with:

| Account | Role |
|---------|------|
| `admin@review.local` | ADMIN |
| `artist@review.local` | ARTIST |

plus a sample project with one sequence, one shot and one reusable asset. Passwords
are defined in the seed script — change them (or drop the seed) for anything
public-facing.

## First steps

1. Sign in as an administrator.
2. Open **Admin** (sidebar) and review the studio settings: default pipeline
   settings (resolution / framerate / frame ranges), video transcoding renditions,
   upload size limits, SMTP.
3. Create a **project**, then sequences/shots and assets, or import your structure.
4. Invite users from **Admin → Utilisateurs** and set their roles
   (see [Users & roles](../admin-guide/users-and-roles.md)).
5. Upload a first media on a task version and open it in review.

## Related pages

- [Projects & pipeline](../user-guide/projects-and-pipeline.md)
- [Upload & publishing](../user-guide/upload-and-publishing.md)
- [Admin overview](../admin-guide/overview.md)
