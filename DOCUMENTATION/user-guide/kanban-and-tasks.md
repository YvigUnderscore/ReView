# Kanban & tasks

> Updated: 2026-08-21

## Tasks

Tasks are the unit of work: typed (`MODELING`, `RIGGING`, `ANIMATION`, `FX`, `LIGHTING`,
`COMPOSITING`, `LOOKDEV`, `LAYOUT`, `OTHER`), attached to a **shot** or an **asset**,
carrying a **department** (the project's own pipe step), an **assignee**, a **status**,
optional **dates**, a **checklist**, and the **versions** that get reviewed.

A task is also the only thing that can hold an assignee. An asset or a shot does not
have one: work is split by stage, and each stage has an owner. See
[Projects & pipeline](projects-and-pipeline.md#assigning-work).

## Statuses

Each task carries two values that move together:

- **`pipelineStatusId`** — the studio's own status, with its name and colour. This is
  what you see everywhere.
- **`status`** — the built-in family: `TODO`, `IN_PROGRESS`, `PENDING_REVIEW`,
  `APPROVED`, `REJECTED`, `RETAKE`. The server derives it from the custom status.

A project that has never defined a status list falls back to those six values, and the
kanban shows six columns instead.

## The kanban board

Each project has a board at `/projects/:id/kanban`. Reach it with the **Kanban** link in
the project header, from the command palette (Ctrl+K), or with the keyboard shortcut
**`g` then `k`** (see [Navigation & search](navigation-and-search.md)).

### Columns

**Columns come from the project's own status list.** A studio connected to ShotGrid
commonly defines fifteen of them; fifteen columns side by side do not read, so they are
grouped into five collapsible **families** on a horizontally scrollable band:

| Family | Built from |
|--------|-----------|
| To do | `TODO` |
| In progress | `IN_PROGRESS` |
| In review | `PENDING_REVIEW` |
| Done | `APPROVED` |
| Set aside | `RETAKE` and `REJECTED` |

Within a family, columns keep the order of the project's own list. Collapsing a family
hides its columns, not its cards: the counts stay.

A task whose status is not offered by this project — inherited from another site, or a
status that has since been removed — is filed under the **first column of the same
family** rather than vanishing from the board.

### Moving a card

**Drag a card into a column.** The pointer has to travel 5 px before the drag starts, so
a plain click still opens the card. Cards can also be moved with the keyboard, using the
drag-and-drop library's own keyboard handling.

Dropping writes the **exact status of the column** — `pipelineStatusId` when the column
comes from the project's list, the enum value otherwise. That distinction matters: the
old six-value board turned *On Hold* into *Waiting to Start* on the way through.

The card moves the moment you let go. If the server refuses, the board reloads and a
toast says *Could not move*.

### Setting a status by right-click

**Right-click a card → Status → pick a value.** Same submenu as everywhere else in the
application: a radio group with the studio's colour dots, the current value ticked, and
a **No status** entry (hidden on a ShotGrid-linked project — the remote site cannot
store an empty status).

The right-click gesture is open to **project managers and to the task's own assignee** —
which is exactly what the server allows: from an assignee it accepts only the status and
the checklist. It is the most useful gesture on this screen for an artist.

### Filters

The filter bar covers **text** (task name and parent label), **status**, **assignee**,
**sequence**, **department** and **task type**. The assignee list is built from the
people actually present on the board, not from the whole directory.

Named presets are saved server-side, per account and per project (scope
`kanban:<projectId>`), and share their mechanism with the Shots, Assets and Reviews
lists.

### Loading

The whole board loads in a **single request** (`GET /api/tasks/board?projectId=`) — one
call, not one per shot and one per asset. It is capped at **2000 tasks**; past that the
board says *Showing n of N tasks — narrow the filters to see the rest* rather than
showing a partial board silently.

The kanban has **no multi-selection**: bulk changes go through the API
(`PATCH /api/bulk/tasks`) or through the Assets tab selection bar.

## Task page

A task opens at `/tasks/:id`. From there:

- read the **location line** — project › sequence · shot, or project › asset — and the
  breadcrumb above it;
- see the **type** badge and the **status** badge;
- open the **Original comment** chip, when the task was created from a review comment
  (right-click a comment in review → *Create a kanban task*): it reopens the review at
  the exact frame and annotation of that comment;
- fill the **Schedule** row — a planned **start** date and a **due** date. Supervisors
  and admins edit them; everybody else sees them read-only, and the row is hidden
  entirely when neither date is set. These two dates are what feed the calendar and the
  Gantt of the [Production tab](production-reporting.md);
- tick items on the **checklist**. The assignee (or a manager) can check and uncheck;
  managers add and remove items. Checklists can also be populated in bulk via
  [CSV import](../admin-guide/project-organization.md#csv-import--export-shotgrid--ftrack--kitsu-bridge);
- browse the **version timeline**, open any media in review, create the next version,
  publish, or drop files;
- **right-click anywhere on the page → Status** to move the task on, with the same
  rights as on the kanban card.

The task page does **not** carry an assignee picker. Change an assignee from:

- the project's **Overview** tab, *Tasks to handle* panel — a per-row dropdown next to a
  per-row status select, for managers;
- the **Assign** submenu on an asset (right-click), which writes the assignee onto the
  matching task;
- the **selection bar** of the Assets tab, for a whole batch;
- the API (`PATCH /api/tasks/:id` with `assigneeId`, or `PATCH /api/bulk/tasks`).

## Versions on a task

Versions live under the task, newest first, in a timeline. Each row expands to its
media.

- **Right-click a version card** → *Review decision…* (supervisors and admins) or
  *Decision history…* (everyone else), *Watch this version*, *Add to playlist…*.
- **Drop files on a version card** to add them to *that* version. Drop them on the zone
  above the list — or anywhere on the page — to create the **next** version and fill it.
- A version hosting a **live review session** shows a pulsing `LIVE · n` badge; clicking
  it joins the room.

## Use cases

### Clearing the morning board

You come in and want the day's picture in one screen.

1. `g` then `k` on the project.
2. Filter **assignee = me**, and collapse the *Done* and *Set aside* families — you are
   not interested in what is finished.
3. What is left is your day. Right-click each task you start → **Status** → the studio's
   *In progress* entry; you do not need a manager for that, the task is yours.
4. At the end of the day, drag the finished cards into the review column. The badge
   updates on the shot card and on the sequence page at the same time.

### Preparing a supervisor's pass

You want the list of everything waiting on you, across sequences.

1. Filter **status** on the studio's *Pending review* entry, leave the assignee empty.
2. Open each card, read its versions, and give a decision from the version card
   right-click → *Decision…*.
3. Send a shot back with a **retake** status: right-click the card → **Status** → the
   studio's retake entry. The card jumps to *Set aside*, and the artist sees the change
   on their own board without a message being sent.

### Splitting a new batch of work

Forty new shots have just been generated and none of them has a task.

1. Go to the project's **Assets** or **Shots** tab depending on what the batch is.
2. For assets: tick the cards, **Assign** in the selection bar, pick the artist and the
   departments. Missing tasks are created as `TODO` and assigned in one pass.
3. Open the kanban: the forty new cards are in the *To do* family, each carrying its
   department, its parent shot or asset, and its owner.

On a ShotGrid-driven project step 2 refuses to create tasks — they must be born on the
remote site, otherwise the next synchronisation would see two of each. Departments with
no task are listed greyed out so you can see that the pipe does plan for them.

### Reading a board that says it is incomplete

On a feature-length project the banner appears: *Showing 2000 of 3417 tasks*.

Narrow with a filter — one sequence, or one department — rather than scrolling. Every
filter is applied client-side over the same single payload, so the board reacts
instantly, and a named preset saves the combination for tomorrow.

## Related pages

- [Projects & pipeline](projects-and-pipeline.md) — hierarchy, statuses, assignment
- [Production & reporting](production-reporting.md) — where the dates and the workload
  show up
- [Review approvals](review-approvals.md) — decisions, which are a separate axis from
  pipeline status
- [Project organization (admin)](../admin-guide/project-organization.md)
- [Navigation & search](navigation-and-search.md)
