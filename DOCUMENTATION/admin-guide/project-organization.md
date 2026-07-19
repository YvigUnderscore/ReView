# Project organization & per-project rights

> Updated: 2026-07-19

Tools for supervisors and admins to structure, protect, and delegate projects.

## Archiving (read-only, restorable)

Archive a project from *Project → Edit → Status → Archived*. An archived project
is **read-only**: uploads, comments, new versions, tasks, and structure changes
(shots/sequences) are refused with `403 PROJECT_ARCHIVED`. Reviews and existing
media stay fully viewable.

- Archived projects are hidden from the sidebar, home, reviews, documents, and
  the default *Projects* list.
- Find them under *Projects → Archived* tab; **Un-archive** restores them to
  *Active* (right-click / row action).
- Archiving is reversible and never deletes data (use the trash for deletion).

## Duplicating a project & templates

*Projects → right-click a project → Duplicate* recreates the **structure only**:
sequences, shots, project settings, and — if *Copy tasks* is checked — the shot
tasks (reset to `TODO`, unassigned). Media, versions, comments, and assets are
**not** copied.

- Mark a project as a template by setting `isTemplate` in its settings; duplicate
  it to start new projects from a known structure. The flag is dropped on the copy.

## Storage quota & usage

*Project → Settings → Storage* shows current consumption (sum of the project's
media) and lets a manager set a **quota in GB** (empty = unlimited).

- When set, uploads that would exceed the quota are refused with
  `403 PROJECT_QUOTA` — for everyone, admins included.
- `GET /api/projects/usage` returns per-project usage/quota for admin dashboards.

## Upload naming convention

*Project → Settings → Naming convention* enforces a **regex** on uploaded file
names, with a policy:

- **Off** — no check;
- **Warn** — non-matching names still upload, the uploader gets a toast warning;
- **Reject** — non-matching uploads are refused with `400 NAMING_REJECTED`.

The settings panel includes a live tester. An invalid regex never blocks uploads.

## Per-project roles

Members can be given a **project role** that overrides their global role for that
project only (*Project → Members → role selector*):

- **Global role** — inherit the studio-wide role;
- **Supervisor (project)** — local elevation: manage this project's members and
  settings without a global manager role;
- **Artist** — contribute (upload, tasks);
- **Client** — read & comment only (no upload, no task creation → `403
  ROLE_FORBIDDEN`).

Global **admins** and **supervisors** keep studio-wide access and are never
demoted by a project role. Project roles never leak across projects.

## CSV import / export (ShotGrid / Ftrack / Kitsu bridge)

From the project header (managers): **Import CSV** / **Export CSV**.

- Columns: `sequence, shot, name, tasks` (tasks separated by `|`). Header row
  required; `,` or `;` delimiters and quoted fields are supported.
- Import runs a **dry-run preview** (counts + row errors) before you commit.
  Existing shots are skipped (never overwritten); missing sequences are created.
- Export produces the same format, re-importable as-is. Fields starting with
  `= + - @` are neutralized against spreadsheet formula injection.

## Task checklists

Tasks carry a checklist (`[{ text, done }]`). On the task page, the **assignee**
(or a manager) can tick items; managers add/remove items. See
[Kanban & tasks](../user-guide/kanban-and-tasks.md).

## Related pages

- [Projects & pipeline (user guide)](../user-guide/projects-and-pipeline.md)
- [Users & roles](users-and-roles.md)
- [Pipeline settings](pipeline-settings.md)
