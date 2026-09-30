# Production & reporting

*Where every shot stands step by step, what is late, what goes in circles, who carries it, and at what rhythm — all derived, nothing typed.*

> Updated: 2026-09-24

The **Production** tab answers five questions about a project — where it stands, what is
blocked, what keeps coming back, who is carrying it, at what rhythm — and then adds a
lightweight schedule. It is read-only reporting with two exceptions: the two optional task
dates, and the status or assignee you set straight from a grid cell.

## Reading the tab

Open a project and select **Production** (`?tab=production`). A **summary line** sits on top
and stays there — four figures that answer *is this going well?* without reading anything
else:

| Figure | What it counts |
|--------|----------------|
| Percentage done | Tasks in a terminal status, out of the total that counts |
| Awaiting review | Tasks the studio's vocabulary puts in the *In review* family |
| Past due | Tasks whose due date has gone by |
| Nobody assigned | Tasks with no assignee |

The last three are alerts and only take colour above zero: a "0 past due" in red would teach
you to ignore the colour. All four are **counted by Postgres over the whole project**, not
measured on the lists below — they used to be the *length* of lists capped at fifty, so a show
with three hundred overdue tasks displayed "50", and the tile got less true as the situation
got worse. When a total does exceed what its list can show, the tile says so under the label:
*First 50 shown*.

Under it, five tabs — the five questions do not get asked at the same time. A supervisor
opens *What is blocking* in the morning; production opens *Schedule* at the end of the week.

| Tab | Holds |
|-----|-------|
| **Where the project stands** | The *Shots by department* grid, then pace and projection |
| **What is blocking** | Three short lists: past due, nobody assigned, waiting for review |
| **Retakes** | What goes in circles: retakes per shot, review rounds, the worst shots |
| **Who is doing what** | The load per person |
| **Schedule** | Deadline calendar and sequence Gantt — or a line telling you to set a date |

Pace sits with the grid rather than in a tab of its own: *at what rhythm* extends *where do
we stand*, and the two are read together. The badge on *What is blocking* adds the three
lists together, so a task that is both late and unassigned counts twice and no list passes
fifty.

> [!IMPORTANT]
> **The whole tab is reserved to supervisors and administrators of the project.** It shows
> each artist's load by name, their late tasks and the work nobody has taken — internal
> information a client invited onto the project has no reason to read. Every read behind the
> tab is refused to anyone else, so the restriction cannot be worked around by calling the
> API directly.

Four calls feed it: `GET /api/projects/:id/production?weeks=` for the summary, the attention
lists, the load and the pace; `GET /api/projects/:id/grid` for the grid, one page of shots at
a time; `GET /api/projects/:id/stats` for the retakes; `GET /api/projects/:id/schedule` for
the calendar and the Gantt. Everything is **counted in the database** — the tab used to load
every task of the project into memory to count them in JavaScript, which is exactly what
stopped working on a feature-length show.

> [!NOTE]
> The observation window selector offers 4, 8, 13 and 26 weeks. The API itself accepts any
> value from 2 to 52 weeks, for a script that wants a different slice.

## What a gauge refuses to count

Every block on this tab reasons in **families**, not in raw statuses — that is what lets a
studio with fifteen ShotGrid statuses and a studio with the six built-in values read the same
page.

![A task without a studio status is classified by its built-in value; with one, isInactive and isDone decide first and the legacyStatus bridge only handles the middle, with an approved-looking bridge that is not terminal demoted to In review.](../assets/user-guide/status-to-gauge.svg)

| Family | With no studio status | With a studio status |
|---|---|---|
| To do | `TODO` | bridge on `TODO` |
| In progress | `IN_PROGRESS` | bridge on `IN_PROGRESS` |
| In review | `PENDING_REVIEW` | bridge on `PENDING_REVIEW`, **and** any bridge on `APPROVED` that is not flagged `isDone` |
| Done | `APPROVED` | `isDone` — whatever the bridge says |
| Set aside | `RETAKE`, `REJECTED` | bridge on `RETAKE` or `REJECTED` |
| Inactive | — | `isInactive` |

Two rules deserve to be spelled out. **`isDone` is the only authority on "finished"**: a
status that merely bridges onto `APPROVED` without being terminal is demoted to *In review*,
because a non-terminal status can never count as done. And **an inactive status is counted
almost nowhere**:

| Block | Done | Inactive |
|---|---|---|
| A grid cell | a filled dot — the studio's own colour where there is one, the Done green otherwise | a filled dot all the same, greyed when the studio set no colour, and named *Inactive* in the legend |
| A sequence tally (`n of m done`) | counted in `n` and in `m` | counted in `m` only, never in `n` |
| Past due / Nobody assigned / Waiting for review | removed | removed |
| Who is doing what | removed | removed |
| Percentage done, and the projection | counted on both sides | not counted at all |

> [!IMPORTANT]
> A task set to *omitted*, *n/a* or *declined* is **invisible on every gauge of this tab** — it
> is not late, nobody carries it, and it neither advances nor holds back the percentage. It
> keeps its cell in the grid, because a grid is a map of what exists rather than a count, and
> it keeps its place on the calendar and the Gantt below, which schedule rather than count.
> Counting such tasks as remaining work would inflate the backlog forever; counting them as
> done would flatter the show.

Inactive statuses come from the ShotGrid synchronisation, which flags the site codes `omt`,
`dis`, `ign`, `na` and `dcl`. A studio with no ShotGrid link never has one.

## Shots by department

The first tab holds a grid: **one row per shot, one column per department, one task per
cell**. It answers what no summary could — *which shot is waiting on what, and who has it*.

![The Shots by department grid of a project, then its kanban, where a Compositing card moves from In review to Done.](../assets/user-guide/production-to-kanban.gif)

![A filter bar and a legend sit above a table whose rows are shots grouped under a line per sequence carrying the progress tally of the group, and whose columns are the project departments in pipeline order; a filled dot marks a task and who holds it, a hollow ring a department scheduled but not started, and a dash a department the shot never goes through.](../assets/user-guide/production-grid-anatomy.svg)

- **Rows are shots**, grouped under a line per **sequence**. The group line carries the
  sequence code, its shot count and a stacked bar with `n of m done` for the whole group;
  collapsing it hides the shots and keeps that tally, so a collapsed grid reads as a summary
  per sequence. Shots that belong to no sequence gather under *Outside sequence*.
- **Columns are the project's departments in pipeline order** — the order the studio arranged
  them in, not alphabetical. A project that defines its own department list uses it; otherwise
  the studio's list applies. The column header carries the department name and a thin bar in
  its studio colour, the same hue it wears everywhere else.
- **The row header carries the shot code**, which opens the shot page, and beside it the shot's
  **own status** — the one the rest of the application shows on shot cards, and that this tab
  never used to show at all.

### Three marks, three meanings

| Mark | Means | Reads as |
|------|-------|----------|
| A filled dot, and an avatar when the task is assigned | A task exists on this shot for this department | Work engaged — the dot takes the studio status colour, or its family colour |
| A hollow ring | The department is on this shot's programme, but no task has been created | *Not started* — work to do |
| A dash | The department is not on this shot's programme | *Not scheduled* — nothing to expect here |

The difference between the last two is the one the old screen lacked entirely: an empty cell
read as "nothing to report" whether or not anything had ever been promised. A **legend above
the table names the five families plus *Inactive*, and both marks that have no family** — no
information on this screen is reserved for whoever hovers the right pixel.

Hover a cell, or reach it with the keyboard, and one line spells out everything it knows:
department, status, assignee (or *Unassigned*), how many versions were delivered, the last
activity date, the due date.

### Filtering, and acting from a cell

Five filters sit above the grid — **episode** (only where the level is on), **sequence**,
**department**, **assignee**, **status** — and they are cumulative. They are applied by the
database, and they decide **which shots appear as rows, never which cells a row shows**: a
grid whose columns emptied out under a filter would stop being readable. *Clear the filters*
appears as soon as one is set.

A sixth control, **Hide empty columns**, is local to the screen and asks the server nothing:
it drops every department that none of the shots currently loaded goes through.

> [!TIP]
> **Right-click a cell** for *Status* and *Assign*; left-clicking opens the same menu, because
> a trackpad has no right button. The shot's status chip in the row header works the same way.
> Both writes offer **Undo** in the toast that confirms them, and the grid refreshes in place —
> it is the one screen on the tab where you can fix what you are looking at.

Setting a status or an assignee is reserved to supervisors and administrators, and a cell with
no task offers no menu: there is nothing there to change. A status change follows the studio's
own vocabulary where there is one, and the built-in values otherwise — the same choices, and
the same push to ShotGrid, as everywhere else in the application.

### What the grid does not show

- **Assets have no row.** The grid is a shot map; an asset's tasks live on the
  [kanban](kanban-and-tasks.md) and in the attention lists.
- **A department carrying two tasks on the same shot shows the first one** in pipeline order.
  A task whose department is not in the project's list has no column to appear in.
- The grid pages **by shot**, fifty at a time, with *Load more* under it and, beside that, how
  many shots the current filters match in all. A page never cuts a row in half; the API accepts
  up to 200 shots per page for a script that wants fewer round trips. Rows are virtualised, and
  both the header row and the shot column stay put while you scroll.
- *No shot matches these filters.* is what an empty result says, rather than an empty frame.

## What is late or blocked

Three short lists rather than one aggregate number: **Past due**, **Nobody assigned**,
**Waiting for review**. Each line shows the parent, the task name and its due date, and opens
the task.

- **A finished task is never listed**, and neither is an inactive one: both families are
  removed before anything else happens. Tasks in *Set aside* stay — a retake past its due date
  is still late.
- **Past due** compares the due date to now, so a task due today is late only once its
  timestamp has passed.
- **Waiting for review** is the *In review* family, reached through the studio's own statuses
  as well as the built-in one.
- The three lists are **not exclusive**: an unassigned, overdue task waiting for review appears
  in all three.
- Each list is bounded **in the database** at **50** tasks, ordered by due date with undated
  ones last. The badge next to the heading counts the rows that came back, the list shows the
  **first 8**, and an *and n more* line closes it. The tile at the top of the page carries the
  real total — read it there, not here.
- A list with nothing in it says *Nothing here — good.*

## Retakes: what goes in circles

A studio does not lose its time on difficult shots, it loses it on shots that come back. Four
figures open the tab, and a dash means *not measured* rather than zero:

| Figure | What it is | Counted over |
|---|---|---|
| Retakes per shot | Retake decisions per shot | Every shot of the project |
| Review rounds per shot | Decisions rendered per shot — a shot right first time costs one | Every shot of the project |
| Days per review | Whole days from a shot's **first version** to its **first approval** | Shots that have both |
| Approved without retake | The share that got through without a single retake | **Approved shots only** |

That last denominator is deliberate: a shot still in review has not finished spending its
retakes, so counting it would drag the rate down all through production.

Under them, **Shots by retake count** spreads the show across four buckets — `0`, `1`, `2`
and `3+` — leaving out shots that were never delivered, since they cost nothing. Then **Shots
going in circles** names the worst, sorted by retakes, then by open notes, then by code, and
shows at most eight. Each line links to its shot and carries its retakes, review rounds,
review days and open notes.

> [!NOTE]
> The same panel is available as a block on the project's
> [Overview](personalization.md#the-project-overview-block-by-block), where a supervisor can
> keep it in sight without opening the Production tab.

## Who is doing what

The load per person, **counting only what is left** — done and inactive tasks are excluded.
Each row shows the split across to-do / in-progress / in-review / set-aside, the total, and how
many of those are **late**. The late count overlaps the others; it is not a sixth bucket, and it
is computed by the database alongside the totals.

Rows are sorted by total, descending, with the **unassigned** row always last regardless of its
size — it is a gap to fill, not a person to compare against. The bars are scaled against the
largest total, so one glance shows who is carrying the batch. Each name links to that person's
profile.

When nothing is left anywhere, the block says *Nothing left to do.* rather than drawing an
empty chart.

## Pace and projection

Two weekly series are counted over an observation window you choose — **4, 8, 13 or 26 weeks**,
defaulting to 8. Weeks are ISO weeks starting Monday, counted in UTC, and empty weeks are kept
so a gap reads as a gap.

| Series | Counts | Used for |
|---|---|---|
| **Media published per week** | A published media created inside the window | The bars drawn on screen — the output of the show |
| **Tasks crossed per week** | A task whose first review approval falls inside the window | The rate printed above them — the velocity |

![Two weekly series, media published and tasks crossed; only the task velocity divides the remaining tasks, and the projected end is now plus the ceiling of remaining over the rate times seven, in days.](../assets/user-guide/projection-arithmetic.svg)

Above the bars, three figures printed together: the overall progress (`done/total` tasks and a
percentage), the observed rate as *n.n tasks per week*, and the **projected end date**, followed
by *at the current pace*.

The projection is `now + ceil(remaining ÷ rate × 7)` **days** — the rounding up is to the day,
not to the whole week. Ten tasks left at three per week puts the marker 24 days out, not 28.
`remaining` is the tasks that are not done, inactive statuses already excluded.

> [!WARNING]
> The remainder counts **tasks**, so the rate has to count tasks as well: the panel once divided
> a remainder in tasks by a rhythm in published media and announced a delivery in December 2028.
> Both series are still counted, because output and velocity are both worth watching, and each
> appears where it belongs — output as the bars, velocity as the rate. But **they are never
> divided by one another**. Read the date as an order of magnitude all the same,
> and never quote it without the rate beside it — which is why the panel prints them on one line.

When no date can be honestly computed, the panel says **which** of the three cases it is:
*Nothing left to do — no end to project*, *Not enough pace to project an end* (nothing crossed
over the window), or *Nothing counted over this window* (no task counts at all). An absent
projection that gave no reason left the reader unable to tell good news from no news.

## The schedule: two dates, a calendar and a Gantt

Both bottom blocks are fed by the same thing: two optional dates on a task, a planned **start**
and a **due** date. Set them in the **Schedule** row of a task page — supervisors and admins
edit, everybody else reads, and the row is hidden entirely when neither date is set. Neither
block appears at all until at least one task in the project carries a date, and the read is
bounded at **2 000** dated tasks.

Unlike the gauges above, the schedule shows **every dated task**, done and inactive included: it
answers "when", not "how far along".

### Deadline calendar

A monthly calendar placing each task on its **due date**.

- Navigate with the arrows; **Today** jumps back to the current month, and the current day is
  highlighted. Weeks start on Monday, with weekday names in the reader's language.
- Each day shows up to **three** tasks — a coloured dot for the status, the location and the
  name — then a `+n` overflow marker. Click one to open the task.
- **Drag a task from one day to another.** The drop writes the new **due** date only; the start
  date is untouched. A toast confirms *Due date moved*, and the Gantt and the rest of the tab
  refresh with it. The date is stored at **midday UTC** so it does not slip a day for readers
  west of Greenwich.

The drag reads your **effective role on this project**, so a supervisor by membership can move a
deadline here even when the *Schedule* row of the task page — which reads the account's global
role — stays read-only for them.

### Sequence Gantt

A read-only timeline grouping dated tasks **by sequence**, alphabetically, with tasks that have
no sequence last. Each bar links to its task and is coloured by the studio's own status where
there is one, by family otherwise.

| Scale | Window | When to use it |
|---|---|---|
| *Month* | 30 days ahead, starting a week in the past | The current push |
| *Quarter* | 90 days ahead, starting a week in the past — **the default** | The usual planning horizon |
| *Everything* | Every dated task, whatever its date | A short project, or an overview you already know will be dense |

The windowed scales start a week in the past so that what has just finished stays visible. On a
feature-length project, *Everything* squeezes a year into one screen width and no bar stays
readable — which is exactly why the choice exists.

A bar spans **start date → due date**. With only one of the two it collapses to a marker at that
date; if the due date precedes the start date the two are swapped rather than drawing backwards.
A bar that leaves the window is clipped and says so on hover. A single vertical line marks
today, drawn once across the whole chart rather than per row.

## The weekly production report

Supervisors and admins can subscribe to a **weekly production report** in
**Profile → Notifications**. It is a per-account subscription, opt-in: an unset preference means
no mail.

- **Sent on Monday**, at the studio's digest hour (`DIGEST_HOUR`, default 07:00, in the server's
  time zone). The daily digest uses the same hour and is a separate subscription.
- **Content**: one studio-wide table, identical for every recipient — one row per active project,
  with versions published, approvals, retakes and open notes. The first three cover the **last 7
  days**; open notes are a running total of unresolved root comments. A "version published" is a
  version with at least one media published inside the window. Archived and deleted projects are
  left out.
- **It is not sent** when SMTP is not configured, when nobody has subscribed, or when there was no
  activity anywhere in the week. A project with nothing to report is dropped from the table; if
  every project is dropped, no mail goes out at all. There is no "quiet week" email.
- Service accounts never receive it, every message carries an unsubscribe link, and each recipient
  gets it in their own language.

## Use cases

### The Monday production meeting

You have ten minutes and need to know what to talk about.

1. Open **Production** and read the summary line. If the three alerts are dark, the show is fine
   and the meeting is short.
2. Collapse every sequence in the grid. You are looking at one bar per sequence: the one that is
   dragging is obvious. Expand it, and you see which shot is waiting on which department.
3. Read the three attention lists in order. *Nobody assigned* is the one you can fix on the spot —
   and you can fix it in the grid itself, by right-clicking the cells.
4. *Who is doing what* tells you whether the load is one person's problem or the batch's;
   *Retakes* tells you whether the same shots keep coming back.
5. Set the observation window to **13 weeks** if the project has been running a while: 4 weeks
   reacts to a single good fortnight, 13 does not.

### Following a single department

Lighting is behind and you want to know by how much.

Filter the grid on that department and read the column: every shot that goes through lighting,
with its status and its holder. Tick **Hide empty columns** to get rid of the rest. When you want
to move the work rather than look at it, the [kanban](kanban-and-tasks.md) with the same
department filter is the board; come back a week later and compare the column.

### Handing out the unassigned work

The *Nobody assigned* tile says twelve.

Open the grid and scan for cells that carry a dot but no avatar — a task nobody holds — or work
down the *Nobody assigned* list and right-click the matching cell. Each assignment confirms with
an **Undo**, so a misfire costs one click rather than a second trip through the task page.

### Planning a delivery window

1. Open a handful of tasks and fill their **Schedule** rows — start and due dates. Only dated
   tasks appear in the calendar and the Gantt.
2. Look at the Gantt on the **Quarter** scale: overlaps within a sequence show up as stacked bars
   around the same week.
3. When editorial moves a deadline, drag the task in the **calendar** rather than opening its page.
   The Gantt follows immediately.

### Explaining the projected end date

Someone asks when the film lands.

Never quote the date without the rate next to it — that is why the panel prints the two together.
Say "at eleven tasks a week we land around the 12th"; if the rate is a recent accident, widen the
observation window and quote the slower figure instead.

## Troubleshooting

**An artist cannot see the Production tab.** That is deliberate: the tab is reserved to
supervisors and administrators of the project, because it names each person's load and their late
work. Artists get their own work on `/my-tasks` and on the kanban.

**The percentage jumped and nobody finished anything.** Somebody set tasks to an inactive status.
They left `total` as well as `done`, so the ratio moved without any work being delivered.

**A task I know is late is not in *Past due*.** It is either done, inactive, or past the fiftieth
task of that list — the lists are bounded in the database, not truncated on screen. The tile above
still counts it.

**A grid column is full of dashes.** None of the loaded shots goes through that department. The
column is kept on purpose, so a pipe step does not silently vanish from the map; tick *Hide empty
columns* when you want it out of the way.

**A cell is empty but the shot is definitely in compositing.** A hollow ring means the department
is on the shot's programme with no task created yet — that is work to do, not work done. A dash
means the department was never put on this shot's programme at all: assign somebody to that
department from the Shots
[selection bar](projects-and-pipeline.md#in-bulk-from-the-selection-bar), which creates the
missing task and attaches the department, and the dash becomes a dot.

**A shot marked *Final* on the site is not counted as done.** Its status bridges onto `APPROVED`
but is not flagged terminal, so it is classified *In review*. Set `isDone` on that status.

**The rate looks far too low for the amount of work going out.** The rate counts tasks whose first
**review approval** landed inside the window, which is the only crossing date that exists in the
database. A studio that publishes without ever recording an approval has output but no measurable
velocity, and no projection either.

**No projected end date is shown.** The panel says which of the three reasons applies — nothing
left, nothing crossed over the window, or nothing counted at all. Widen the window before
concluding the show has stopped.

**The calendar and the Gantt are missing entirely.** No task in the project carries a start or a
due date yet. Fill one *Schedule* row and both appear.

**I can move a card on the kanban but the Schedule row is read-only.** The two surfaces read
different roles — the board and the calendar read your role on this project, the task page reads
your global account role.

**The weekly report never arrives.** Check the subscription in *Profile → Notifications*, that your
account is `SUPERVISOR` or `ADMIN`, and that SMTP is configured. A week with no activity anywhere
sends nothing at all.

## Related pages

- [Kanban & tasks](kanban-and-tasks.md) — where dates, assignees and statuses are actually set
- [Review decisions & approvals](review-approvals.md) — the decisions that feed approvals and retakes
- [Projects & pipeline](projects-and-pipeline.md) — sequences, departments and the two status vocabularies
- [Personalization](personalization.md) — notification subscriptions, saved views and composable pages
- [Navigation & search](navigation-and-search.md) — the personal counters and the pages they open
- [ShotGrid integration (admin)](../admin-guide/shotgrid-integration.md) — where inactive statuses come from
- [SMTP & announcements (admin)](../admin-guide/smtp-and-announcements.md) — mail setup and the digest hour
