# Production & reporting

> Updated: 2026-07-20

The **Production** tab of a project gathers review statistics and a lightweight schedule
(calendar and Gantt). It is read-only reporting: figures are derived from your existing
versions, review decisions and comments — nothing new to fill in except optional task dates.

Open a project and select the **Production** tab. A segmented control switches between
**Statistics**, **Calendar** and **Gantt**.

## The four questions

The **Production** tab of a project answers four questions, in this order.

1. **Where the project stands** — a sequences × departments table. Each cell shows the
   share of work done, split by status family, and the count. Sequence names link to
   their page.
2. **What is late or blocked** — three short lists rather than one aggregate number:
   past due, nobody assigned, waiting for review. Each line opens the task. A finished
   task is never counted as late: its date has passed, but the work is done.
3. **Who is doing what** — the load per person, counting only what is left. The assignee
   was carried by the API all along and displayed nowhere.
4. **Pace and projection** — deliveries per week over a window you choose (4, 8, 13 or
   26 weeks), the overall progress, and a projected end date at the observed pace. The
   projection is always shown together with that pace: on its own, a date reads like a
   commitment, whereas it only holds if the rhythm does.

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

Managers can **drag a due date from one day to another** — the task page is no longer the
only way to change it.


A monthly calendar places each task on its **due date**. Navigate months with the arrows or
jump back with **Today**. Days show up to three tasks (a coloured dot per status); click a
task to open it. The current day is highlighted.

### Sequence Gantt

The **scale** is selectable — month, quarter, everything. On a feature-length project,
“everything” squeezes a year into one screen width and no bar stays readable.


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
