# Kanban & tasks

> Updated: 2026-07-18

## Tasks

Tasks are the unit of work: typed (modeling, rigging, animation, FX, lighting,
compositing, lookdev, layout, other), attached to a **shot** or an **asset**,
assigned to users, and holding the **versions** that get reviewed.

Statuses: `TODO`, `IN_PROGRESS`, `PENDING_REVIEW`, `APPROVED`, `REJECTED`,
`RETAKE`.

## Kanban

Each project has a kanban (`/projects/:id/kanban`, shortcut `g` then `k`): columns
by status, drag-and-drop to move tasks, filters by type/assignee. The task page
shows details, versions and activity.

## Task page

From a task you can:

- browse its versions and open any media in review;
- upload a new version;
- change status/assignee;
- jump to the parent shot/asset and project (breadcrumb).

## Related pages

- [Projects & pipeline](projects-and-pipeline.md)
- [Navigation & search](navigation-and-search.md)
