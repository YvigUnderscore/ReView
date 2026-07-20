# Production & reporting

> Updated: 2026-07-20

The **Production** tab of a project gathers review statistics and a lightweight schedule
(calendar and Gantt). It is read-only reporting: figures are derived from your existing
versions, review decisions and comments — nothing new to fill in except optional task dates.

Open a project and select the **Production** tab. A segmented control switches between
**Statistics**, **Calendar** and **Gantt**.

## Review statistics

The **Statistics** view answers "where does review time go?" for the project's shots:

- **Key indicators** — shots, versions, approval rate (share of *started* shots whose latest
  version is approved), open notes, average review delay, retakes per shot, notes per version,
  total decisions.
- **Convergence per sequence** — a stacked bar per sequence showing how its shots split
  between *approved*, *in review*, *retake* and *not started*, with the approved ratio.
- **Shots to watch** — the costliest shots ranked by review delay, then retakes, then open
  notes. Each row links to the shot.

Definitions:

- **Review delay** — days between a shot's first version and its first approval decision.
- **Shot status** — taken from the review status of the shot's most recent version
  (approval / retake flags are configured in **Admin → Review statuses**).
- **Open notes** — unresolved root comments on the shot's media.

## Task scheduling

Calendar and Gantt are populated from two optional task dates: a **start date** (planned
start) and a **due date** (deadline). Set them from a task page (**Planning** row), visible
and editable to supervisors and admins. Artists see the dates read-only.

### Deadline calendar

A monthly calendar places each task on its **due date**. Navigate months with the arrows or
jump back with **Today**. Days show up to three tasks (a coloured dot per status); click a
task to open it. The current day is highlighted.

### Sequence Gantt

A read-only timeline groups dated tasks **by sequence** (tasks without a sequence appear
last). Each bar spans from start date to due date (falling back to whichever single date
exists), coloured by task status, with a marker for today. Click a bar or its label to open
the task.

## Weekly production report (email)

Supervisors and admins can subscribe to a **weekly production report** in
**Profile → Notifications**. Every Monday morning it emails a studio-wide summary — per
active project: versions published, approvals, retakes and open notes over the last 7 days.
It is only sent when SMTP is configured (see the admin guide) and when there was activity in
the week. The daily digest is a separate, per-user subscription.

## Related

- [Review approvals](review-approvals.md) — review statuses and decisions that feed the stats.
- [Kanban & tasks](kanban-and-tasks.md) — task assignment and status.
- [Personalization](personalization.md) — notification subscriptions.
