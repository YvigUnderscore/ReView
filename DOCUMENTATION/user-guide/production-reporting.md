# Production & reporting

> Updated: 2026-08-21

The **Production** tab of a project answers four questions about where the work stands,
then adds a lightweight schedule. It is read-only reporting: every figure is derived from
tasks, versions, review decisions and comments you already have. The only thing anyone
has to fill in is the two optional task dates.

Open a project and select the **Production** tab (`?tab=production`). It is one scrolling
page, in a fixed order — there are no sub-views to switch between. **Every project member
can read it**; only supervisors and admins can edit task dates.

## Where the project stands

A **sequences × departments matrix**. Rows are the project's sequences in their own
order, with a final *outside sequence* row when some tasks belong to assets or to shots
with no sequence. Columns are the departments actually used, **sorted alphabetically** —
not in pipeline order.

Each cell is a stacked proportional bar plus a `done/total` count, and its tooltip spells
out every family with its count. An empty cell shows a dash. The five families:

| Family | Built from | Colour |
|--------|-----------|--------|
| Done | `APPROVED` | success |
| In review | `PENDING_REVIEW` | warning |
| In progress | `IN_PROGRESS` | info |
| Set aside | `RETAKE`, `REJECTED` | destructive |
| To do | `TODO` | muted |

If no task carries a department yet, the matrix says so instead of drawing an empty grid.

## What is late or blocked

Three short lists rather than one aggregate number: **Past due**, **Nobody assigned**,
**Waiting for review**. Each line opens the task.

- **A finished task is never listed.** Tasks in the *Done* family are removed first: the
  date has passed, but the work is done. Tasks in *Set aside* stay — a retake past its
  due date is still late.
- **Past due** compares the due date to now, so a task due today is late only once its
  timestamp has passed.
- **Waiting for review** is the raw `PENDING_REVIEW` status.
- The three lists are **not exclusive**: an unassigned, overdue task waiting for review
  appears in all three.
- The badge next to each heading counts up to **50** tasks; the list itself shows the
  **first 8**, sorted by due date with undated tasks last, then an *and n more* line.

## Who is doing what

The load per person, **counting only what is left** — done tasks are excluded. Each row
shows the split across to-do / in-progress / in-review / set-aside, the total, and how
many of those are **late**. The late count overlaps the others; it is not a sixth bucket.

Rows are sorted by total, descending, with the **unassigned** row always last regardless
of its size — it is a gap to fill, not a person to compare against. The bars are scaled
against the largest total, so a glance shows who is carrying the batch.

## Pace and projection

Deliveries per week over an observation window you choose — **4, 8, 13 or 26 weeks**,
defaulting to 8. A delivery is a **published media created inside the window**. Weeks are
ISO weeks starting Monday; empty weeks are kept so a gap reads as a gap.

Below the bars: the overall progress (`done/total` tasks and a percentage), the observed
rate as *n per week*, and a **projected end date**.

The projection is deliberately never shown alone. On its own a date reads like a
commitment, whereas it only holds if the rhythm does. It is computed as
`now + ceil(remaining / rate) weeks`, where `remaining` is the count of tasks that are
not done. When there is nothing left, or the observed rate is zero, the panel says
*Not enough pace to project an end* rather than inventing a date.

Note that the rate counts **published media** while the remainder counts **tasks**: read
the projection as an order of magnitude, not as a schedule.

## Deadline calendar

A monthly calendar placing each task on its **due date**. It appears only once at least
one task in the project carries a date.

- Navigate with the arrows; **Today** jumps back to the current month. The current day is
  highlighted. Weeks start on Monday.
- Each day shows up to **three** tasks — a coloured dot per status, the location and the
  name — then a `+n` overflow marker. Click a task to open it.
- **Supervisors and admins can drag a task from one day to another.** The drop writes the
  new **due date** only; the start date is untouched. A toast confirms *Due date moved*,
  and the Gantt and the rest of the tab refresh with it. The date is stored at midday UTC
  so it does not slip a day for readers west of Greenwich.
- Everyone else sees the same calendar without the drag. Dates are then edited from the
  task page.

## Sequence Gantt

A read-only timeline grouping dated tasks **by sequence**, alphabetically, with tasks
that have no sequence last. Each bar is a link to its task.

- **Scale**: *Month* (30 days), *Quarter* (90 days, the default) or *Everything*. The
  windowed scales start a week in the past so what has just finished stays visible. On a
  feature-length project, *Everything* squeezes a year into one screen width and no bar
  stays readable — that is why the choice exists.
- A bar spans **start date → due date**. With only one of the two it collapses to a
  marker at that date; if the due date precedes the start date the two are swapped rather
  than drawing backwards. Bars are coloured by task status.
- A single vertical line marks today, drawn once across the whole chart.

## Task dates

Both the calendar and the Gantt are fed by two optional dates on a task: a planned
**start** and a **due** date. Set them in the **Schedule** row of a task page —
supervisors and admins edit, everybody else reads. When neither date is set, the row is
hidden for readers entirely.

## Weekly production report (email)

Supervisors and admins can subscribe to a **weekly production report** in
**Profile → Notifications**. It is a per-account subscription, opt-in: an unset
preference means no mail.

- **Sent on Monday**, at the studio's digest hour (`DIGEST_HOUR`, default 07:00, in the
  server's local time zone). The daily digest uses the same hour and is a separate
  subscription.
- **Content**: one studio-wide table, identical for every recipient — one row per active
  project, with versions published, approvals, retakes and open notes. The first three
  cover the **last 7 days**; open notes are a running total of unresolved root comments.
  Archived and deleted projects are left out.
- **It is not sent** when SMTP is not configured, when nobody has subscribed, or when
  there was no activity anywhere in the week. A project with nothing to report is dropped
  from the table; if every project is dropped, no mail goes out at all. There is no
  "quiet week" email.
- Service accounts never receive it, and every message carries an unsubscribe link.

## Use cases

### The Monday production meeting

You have ten minutes and need to know what to talk about.

1. Open **Production**. The matrix gives the shape of the film: which sequence is
   dragging, in which department.
2. Read the three attention lists in order. *Nobody assigned* is the one you can fix on
   the spot — note the tasks, then go and assign them from the Assets tab or the project
   Overview panel.
3. *Who is doing what* tells you whether the load is one person's problem or the batch's.
4. Set the observation window to **13 weeks** if the project has been running a while:
   4 weeks reacts to a single good fortnight, 13 does not.

### Following a single department

Lighting is behind and you want to know by how much.

The matrix column tells you the ratio, but the useful screen is the **kanban** with the
department filter on: the Production tab is a map, the kanban is where you move things.
Come back to the matrix once a week to see whether the column moved.

### Planning a delivery window

1. Open a handful of tasks and fill their **Schedule** rows — start and due dates. Only
   dated tasks appear in the calendar and the Gantt.
2. Look at the Gantt on the **Quarter** scale: overlaps within a sequence show up as
   stacked bars around the same week.
3. When editorial moves a deadline, drag the task in the **calendar** rather than opening
   its page. The Gantt follows immediately.

### Explaining the projected end date

Someone asks when the film lands.

Never quote the date without the rate next to it — that is why the panel prints the two
together. Say "at eleven deliveries a week we land around the 12th"; if the rate is a
recent accident, widen the observation window and quote the slower figure instead.

## Related

- [Review approvals](review-approvals.md) — the decisions that feed approvals and retakes
- [Kanban & tasks](kanban-and-tasks.md) — where dates, assignees and statuses are set
- [Personalization](personalization.md) — notification subscriptions
- [SMTP & announcements (admin)](../admin-guide/smtp-and-announcements.md) — mail setup
