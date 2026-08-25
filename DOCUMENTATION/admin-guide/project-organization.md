# Project organization & per-project rights

*Archive, delete, duplicate, quota, episodes and CSV import — what each one does, and which role it really needs.*

> Updated: 2026-08-23

![A project settings tab: pipeline defaults, status vocabulary and departments.](../assets/admin-guide/project-settings.png)

These are the tools that structure, protect and delegate a project. They are reached from
the **project page** rather than from `/admin`, which is convenient and slightly misleading:
several of them still demand a **global** manager role. The split is spelled out for each
feature below, and in full in
[Users & roles](users-and-roles.md#the-subtle-case-the-project-supervisor).

## Archiving (read-only, restorable)

Archive a project from *Project → Edit → Status → Archived*
(`PATCH /api/projects/:projectId`, **global `ADMIN`/`SUPERVISOR`**).

An archived project is **read-only**: `assertProjectWritable` refuses uploads, comments, new
versions, task changes, structure changes (episodes, sequences, shots) and board edits with
`403 PROJECT_ARCHIVED`. Reviews and existing media stay fully viewable, boards stay
readable, and share links keep working.

- Archived projects are hidden from the sidebar, the home page, the reviews list and the
  default *Projects* list.
- Find them under *Projects → Archived*; **Un-archive** returns them to *Active*.
- Archiving is reversible and deletes nothing. It is the correct end-of-show move —
  deletion is not.

> [!IMPORTANT]
> The guard is a **status check, not a permission check**: an administrator gets
> `PROJECT_ARCHIVED` too. If you need to fix one thing in an archived show, un-archive it,
> fix it, archive it again. There is no override.

## Deleting, restoring, purging

![An active project has two exits: archiving makes it read-only and is undone by un-archiving; deleting moves it to the studio trash, from which restoring brings it back and purging destroys it, either on demand by an administrator or automatically once the retention delay has passed.](../assets/admin-guide/project-lifecycle-states.svg)

| Action | Route | Role | Reversible |
|--------|-------|------|-----------|
| Archive / un-archive | `PATCH /api/projects/:projectId` (`status`) | global `ADMIN`/`SUPERVISOR` | Yes, both ways |
| Delete a project | `DELETE /api/projects/:projectId` | global `ADMIN`/`SUPERVISOR` | Yes — soft delete |
| Restore | `POST /api/projects/:projectId/restore` | global `ADMIN`/`SUPERVISOR` | — |
| Purge | `DELETE /api/projects/:projectId/purge` | **`ADMIN` only** | **No** — database rows and MinIO objects are destroyed |

A soft-deleted project sits in *Admin → Maintenance → Trash*. It is **not kept forever**:
the nightly maintenance pass purges anything soft-deleted for longer than
`trash_retention_days` (default **30**), and that sweep covers every level of the hierarchy
— media, versions, shots, sequences, episodes, assets, then projects — children before
parents. It is capped at 2 000 items per pass, so a studio that has just enabled retention
catches up over several nights instead of locking the database for one.

The automatic purge writes **no audit entry and sends no notification**. What you get is a
line in the worker log. Treat the trash as a grace period, not as an archive. See
[System & maintenance](system-and-maintenance.md#trash-and-automatic-retention).

## Duplicating a project & templates

*Projects → right-click a project → Duplicate*
(`POST /api/projects/:projectId/duplicate`, **global `ADMIN`/`SUPERVISOR`**).

The copy recreates the **structure only**:

| Copied | Not copied |
|--------|-----------|
| Sequences (name, code, order, pipeline override) | Media, versions, comments |
| Shots (name, code, start/end frame, order, pipeline override) | Assets |
| Project settings JSON, description, start frame | **Members** — the person who duplicates becomes the only member |
| Tasks, if *Copy tasks* is ticked: name, type, order, checklist — status reset, unassigned | **Episodes**, and the episode a sequence belonged to |
| | **Project-level departments** — see below |
| | The storage quota — the copy starts unlimited |

Four things to know before you rely on it:

- **The new project has exactly one member: you.** Rebuild the team explicitly.
- **Episodes are not copied.** `duplicateProject` selects sequences, shots and optionally
  tasks; the episode rows are left behind and the copied sequences arrive detached. A
  duplicated series project therefore loses its whole episode layer, and a global manager
  has to re-enable the level and rebuild it.
- **Project-level departments are not copied.** Departments are rows in the `Department`
  table, and duplication only copies the settings JSON. The copy falls back to the
  **studio** department list. If the source project had a custom pipe order, re-enter it on
  the copy — otherwise "latest version" resolves against the wrong order (see
  [Pipeline settings](pipeline-settings.md#departments-the-order-is-the-pipe)).
- A name that slugifies to an existing project is refused with `400 SLUG_TAKEN`.

Mark a project as a template by setting `isTemplate` in its settings, then duplicate it to
start new shows from a known structure. The flag is dropped on the copy, so a copy is never
itself a template.

## Storage quota & usage

*Project → Settings → Storage* shows the project's consumption — the sum of the sizes of its
non-deleted media, across shots and assets — and lets a manager set a **quota**.

- The quota is stored in **bytes** (`Project.storageQuota`); the field is presented in GB.
  Empty or `null` means **unlimited**, which is the default for every new project.
- When set, an upload that would push the project past its quota is refused with
  `403 PROJECT_QUOTA` — **for everyone, administrators included**. This is deliberate: a
  quota an admin can silently blow past is not a quota.
- **Setting the quota requires a global `ADMIN`/`SUPERVISOR`** (it is a field of
  `PATCH /api/projects/:projectId`). A project supervisor sees the usage bar but cannot move
  the ceiling.
- Reading usage: `GET /api/projects/:projectId/usage` (any project member) and
  `GET /api/projects/usage` (global `ADMIN`/`SUPERVISOR`, every project at once).

Do not confuse this with the **per-user** storage limit (`User.storageLimit`, studio default
`storage_limit_user` = 10 GB), which is checked against the total of everything that account
has ever uploaded and from which **administrators are exempt**. An upload passes only if it
clears both.

Full order of the checks an upload goes through, so you can read an error correctly — the
first one that fails is the one you see:

| Order | Check | Failure |
|-------|-------|---------|
| 1 | Project access | `403` |
| 2 | Effective role can contribute (not `CLIENT`, not a stranger) | `403 ROLE_FORBIDDEN` |
| 3 | Project not archived | `403 PROJECT_ARCHIVED` |
| 4 | `max_file_size` (studio-wide, default 5 GB) | `400 FILE_TOO_LARGE` |
| 5 | `max_concurrent_uploads` (studio-wide, default 5, counted per uploader) | `429 TOO_MANY_UPLOADS` |
| 6 | Per-user storage limit — **administrators exempt** | `403 STORAGE_LIMIT` |
| 7 | Project quota — **nobody exempt** | `403 PROJECT_QUOTA` |
| 8 | Upload naming rule, mode `reject` | `400 NAMING_REJECTED` |

## Upload naming convention

*Project → Settings → Naming convention* applies a regular expression to uploaded file names
in one of three modes (`off` / `warn` / `reject`). Defaults, the ReDoS refusal
(`400 NAMING_PATTERN_UNSAFE`) and the fail-open behaviour of an invalid pattern are
documented in
[Pipeline settings → upload naming rule](pipeline-settings.md#upload-naming-rule).

Editing it needs the effective project role `SUPERVISOR` — a project supervisor can do this.

## How project settings are written

The settings screen manipulates the **effective** settings, which are the studio defaults
with the project's own overrides on top. That is why it writes **section by section**:

- `PATCH /api/projects/:projectId/settings` — a section absent from the body is left alone,
  a section set to `null` goes back to inheriting from the studio. This is what the screen
  sends, and it only sends the sections you actually touched.
- `PUT /api/projects/:projectId/settings` — replaces the **whole** override. Any section
  missing from the body reverts to the studio default.

Both require `requireProjectManage`, so a project supervisor may use them. The distinction
matters: a `PUT` that carries only the naming rule freezes the studio's resolution,
framerate, burn-ins and colour intent into that project, because they were merely inherited
and are now missing from the body. If you script against the API, prefer the `PATCH`.

*Project → Settings* opens on what the project overrides, and offers to hand each section
back to the studio one at a time. The full inheritance model, section by section, is in
[Pipeline settings](pipeline-settings.md#writing-an-override-and-handing-it-back).

## Per-project roles

*Project → Members → role selector* — guarded by `requireProjectManage`, so a project
supervisor manages their own team.

- **Global role** — inherit the studio-wide role;
- **Supervisor** — local elevation: manage this project's members and settings without a
  global manager role;
- **Artist** — contribute (upload, tasks);
- **Client** — read and comment only; no upload, no task creation (`403 ROLE_FORBIDDEN`).

Global admins and supervisors keep studio-wide access and are **never demoted** by a project
role; project roles never leak across projects. The full rules, including what a project
supervisor still cannot do, are in [Users & roles](users-and-roles.md).

## The Episode level

Series work needs a level above the sequence. It is **off by default**, per project, and
lives in *Project → Settings → Episode level*.

- The switch is `PUT /api/episodes/settings` and, like every other episode write, requires a
  **global `ADMIN`/`SUPERVISOR`**. Reading the setting is open to any project member — it is
  what tells the screens whether to show the level at all.
- While the level is off, every episode route answers `409 EPISODES_DISABLED`. That is a
  state, not a permission: the same request succeeds the moment the level is on. It also
  means nothing can be read or written through a guessed URL while the interface pretends
  the level does not exist.
- **Turning the level off destroys nothing.** The episodes and the sequences attached to
  them survive, hidden, and reappear intact when it is turned back on. The switch shows how
  many episodes and how many linked sequences are about to be hidden, precisely so that it
  can be flicked without a gamble.
- An episode groups sequences. It carries no shot and no version of its own, and it has its
  own trash entry like every other level of the hierarchy.

A long feature film never sees any of this. A series project should have the level turned on
by a global manager once, at the very start — a project supervisor cannot do it later, and
the CSV import will report `EPISODES_DISABLED` on any file that carries an episode column.

## CSV import / export

The two buttons in the project header are how a studio enters ReView without writing a
script — and how it leaves with its structure intact.

| | Route | Role |
|---|-------|------|
| Template | `GET /api/projects/:projectId/import-csv/template` | effective project `SUPERVISOR` |
| Import | `POST /api/projects/:projectId/import-csv` | effective project `SUPERVISOR` (local elevation OK) |
| Export | `GET /api/projects/:projectId/export-csv` | **any project member**, including `CLIENT` |

> [!CAUTION]
> That export permission is worth reading twice: the shot list and task names of a project
> are readable — and downloadable — by every member of it, clients included. If a shot code
> is itself confidential, do not put a client in the project.

### The shape of the file

The importer recognises **sixteen fields**, and a wide table of aliases for each, so that an
export from ShotGrid, ftrack, Kitsu or a hand-kept spreadsheet is usually understood as it
is. Headers are matched without case, accents or separators: `sg_sequence`, `Cut In`,
`cut_in`, `Task type` and `Échéance` all land where you would expect.

| Field | Recognises, among others | Writes |
|-------|--------------------------|--------|
| `episode` | `ep`, `episode code`, `sg_episode` | The episode a sequence belongs to (level must be enabled) |
| `sequence` | `seq`, `sq`, `scene`, `sg_sequence` | The sequence, created if missing |
| `shot` | `plan`, `code`, `shot number`, `sg_shot` | **The only mandatory column** |
| `name` | `title`, `nom`, `shot name` | Shot name (200 characters max) |
| `description` | `notes`, `brief`, `synopsis` | Shot description (4 000 characters max) |
| `tags` | `keywords`, `labels` | Recognised, but **not written** — reported as `TAGS_UNSUPPORTED` |
| `shotStatus` | `sg_shot_status`, or a bare `status` on a file without tasks | Shot pipeline status, from *this* project's vocabulary |
| `startFrame` | `cut_in`, `head_in`, `frame in` | Start frame |
| `endFrame` | `cut_out`, `tail_out`, `frame out` | End frame |
| `frames` | `duration`, `length`, `cut duration` | Completes the range; a range that contradicts it is flagged `FRAME_RANGE_MISMATCH` |
| `task` | `tasks`, `activity`, `tâche` | One or more tasks, separated by `\|` |
| `department` | `step`, `discipline`, `pipeline step`, `task type` | Task department |
| `taskStatus` | `sg_task_status`, or a bare `status` on a file with tasks | Task pipeline status |
| `assignee` | `artist`, `owner`, `assigned to`, `responsable` | Task assignee, matched on email then on username or full name |
| `startDate` | `begin`, `date début` | Task start date |
| `dueDate` | `due`, `deadline`, `échéance` | Task due date |

- **A header row is required**, order is free. The delimiter is whichever of `,`, `;` or TAB
  appears most often in the header line, falling back to `,` when none does — so a
  tab-separated paste from a spreadsheet is accepted, and a French export full of
  semicolons is not confused by the commas inside its labels. Quoted fields and doubled
  quotes are handled.
- **One line per task is the norm**, because that is what trackers export. Lines that name
  the same shot are **merged**, not rejected as duplicates. Two lines that disagree on the
  same shot field raise `CONFLICTING_VALUE` and the first value wins.
- Limits: 1 000 000 characters of body, 20 000 data lines (`TOO_MANY_ROWS`), 200 mapping
  overrides.
- Download the **template** from the import dialog to get the full header and two example
  rows.

### From file to committed plan

![The six stages of an import: a file of any header dialect is read, its columns recognised and optionally re-pointed by hand, then previewed without writing anything; the preview can be corrected and replayed, and only the commit writes, inside one bounded transaction, leaving an audit entry that carries the counters.](../assets/admin-guide/csv-import-pipeline.svg)

The import dialog follows the order in which the questions actually come up.

1. **Drop the file** — drag and drop, the file picker, or paste the text.
2. **Preview** (`commit: false`). Nothing is written. You get three things back:
   - the **column mapping**, one row per column of your file, showing which field it was
     matched to. Re-point a column, or neutralise it, and preview again — your file is
     never edited, only the way it is read;
   - the **counts**, as a create / update / unchanged table for episodes, sequences, shots
     and tasks, plus rejected rows and warnings;
   - the **outcome of each row** (`create`, `update`, `unchanged`, `blocked`) and the
     **issue list**, each issue carrying its line, its column, the offending value and the
     shot code. The screen shows the first thirty; the whole report downloads as a CSV, so
     the corrections happen in the spreadsheet the file came from.
3. **Import** (`commit: true`). The button stays disabled while there is nothing to write.

The plan is **recomputed on the live state immediately before writing** — the preview you
looked at commits nothing by itself. The write runs in one transaction with an explicit
two-minute budget, `createMany` in chunks of 500, and the commit — not the preview — checks
that the project is not archived. On success, the audit records `PROJECT_IMPORT_CSV` with
the counters as metadata.

### What it changes, and what it never changes

- **Identity.** A shot is `(project, sequence, code)`; a task is `(shot, name)`. Matching is
  case-insensitive and uses those keys, not the shot code alone.
- **Existing rows are updated, not skipped.** A column present with a new value overwrites
  it; a column **absent from the file never erases anything**. An import is not a
  replacement.
- **Idempotence.** Replaying the same file rebuilds the identical plan, entirely
  "unchanged". That is the property that makes a nightly re-import from a tracker safe.
- **Unknown values are reported, not swallowed.** A status, department or assignee the
  project does not know raises `UNKNOWN_STATUS`, `UNKNOWN_DEPARTMENT` or `UNKNOWN_ASSIGNEE`
  on that line; the rest of the line is still written. Only four issues actually reject
  something: `EMPTY_FILE`, `MISSING_SHOT_COLUMN`, `MISSING_SHOT` and `IN_TRASH`.
- **The trash blocks a row on purpose.** A soft-deleted shot still holds its unique key, so
  a line aiming at one is refused at preview time (`IN_TRASH`) rather than failing the whole
  write later.
- Assignees are looked up among the project's members plus the studio's global managers.
  Service accounts and disabled accounts are excluded — assigning work to a machine means
  nothing.

### Export

The export writes `sequence, shot, name, tasks`, tasks joined by `|`, and re-imports as-is —
which is the cheapest way to move a structure between two instances. Fields starting with
`= + - @` (or tab, or carriage return) are prefixed with an apostrophe to neutralise
spreadsheet formula injection: a shot named `=cmd|…` cannot execute in Excel or Sheets. The
downloadable issue report applies the same guard.

## Task checklists

Tasks carry a checklist (`[{ text, done }]`). On the task page the **assignee** (or a
manager) ticks items; managers add and remove them. Checklists **are** copied when a project
is duplicated with *Copy tasks*. See [Kanban & tasks](../user-guide/kanban-and-tasks.md).

---

## Use case: bringing a studio in from a spreadsheet

*Forty sequences, twelve hundred shots and four tasks each, exported from the tracker in
use since last year.*

1. Open the project, **Import CSV**, and download the **template** first — not to fill it
   in, but to see which sixteen fields exist. Most of them are probably already in your
   export under another name.
2. Drop the export as it is. Preview.
3. Read the **column mapping** row by row. A column matched to the wrong field, or to
   nothing, is fixed here in one click; a column you do not want imported is neutralised.
   Preview again.
4. Read the **counts**. On a first import everything should be in the *create* column. Any
   *update* means the project already knew those shots — which is either right, or a sign
   you are importing into the wrong project.
5. Download the **issue report** and fix the file in the spreadsheet: unknown departments
   and statuses are the usual crop, and they are worth fixing before the import rather than
   after, since they land as missing metadata on twelve hundred tasks.
6. If your file has an episode column, have a global manager enable the **Episode level**
   before importing — otherwise every episode is reported as `EPISODES_DISABLED` and
   silently dropped.
7. Import. Then re-run the preview once more: a clean second pass shows everything
   "unchanged", which is the proof the file and the project now agree.

## Use case: closing a show without losing it

*Delivery is signed off. The show must stop changing but stay reviewable for a year.*

1. Check nothing is mid-flight: *Admin → Maintenance → Jobs*, media queue empty of active
   and failed jobs for that project.
2. Revoke the client share links that are still open — archiving does **not** revoke them,
   and they keep serving media.
3. Export the CSV while the project is still writable, and keep it with the delivery. It is
   a hundred kilobytes and it rebuilds the whole structure elsewhere.
4. *Project → Edit → Status → Archived*. Everything becomes read-only
   (`403 PROJECT_ARCHIVED`); reviews, annotations and comments stay browsable.
5. Do **not** delete it. Deletion starts the retention clock: after `trash_retention_days`
   (30 by default) the nightly sweep purges the project and its MinIO objects for good, with
   no confirmation, no notification and no undo.
6. If disk pressure is the real motive, enable the **derived purge** instead — it drops HLS
   renditions and timeline sprites of old versions while keeping the proxy and the
   thumbnail, so the show stays watchable. See
   [System & maintenance](system-and-maintenance.md#derived-files-purge).

## Use case: bootstrapping a show from last season's structure

*Season 2 has the same sequence layout and the same task template as season 1.*

1. Make sure season 1's settings are the ones you want inherited — the duplicate copies the
   settings JSON verbatim, minus `isTemplate`.
2. *Projects → right-click season 1 → Duplicate*, new name, **tick *Copy tasks***. Tasks
   arrive reset to `TODO` and unassigned, checklists included.
3. **Add the team back.** You are the only member of the copy.
4. **Rebuild the episode layer** if season 1 had one: neither the episodes nor the sequence
   attachments are copied, and re-enabling the level needs a global manager.
5. **Re-enter the departments** if season 1 had a project-specific pipe: they are not copied
   and the copy silently falls back to the studio list.
6. Set the storage quota on the new project (global manager role) — quotas are not copied
   either; the copy starts unlimited.
7. Adjust the delivery resolution and framerate if the season changed format, then verify on
   *Admin → Content → Projects → the new project*, whose hierarchy browser shows the
   effective settings per sequence and shot.

If the structure is meant to be reused every season, keep a dedicated project marked
`isTemplate` with no media in it, and duplicate *that* instead — it never accumulates the
previous season's overrides.

## Use case: a project is eating the bucket

*One show is 60 % of the storage report and nobody agrees on who should stop.*

1. *Admin → Content → Storage* ranks projects by bytes — start from facts, not from the
   loudest complaint. See [Storage map](storage.md).
2. Set a quota on the project (global manager role). New uploads then fail with
   `403 PROJECT_QUOTA` for everyone, which converts a slow leak into an immediate, visible,
   negotiable event.
3. Warn the team first. The refusal happens at upload time, after the artist has already
   produced the file; an unannounced quota is experienced as an outage.
4. If the weight is old renditions rather than sources, prefer the derived purge — it
   reclaims the HLS ladder of everything but the last *N* versions and needs no negotiation
   at all.

## Related pages

- [Admin overview](overview.md)
- [Users & roles](users-and-roles.md)
- [Pipeline settings](pipeline-settings.md)
- [System & maintenance](system-and-maintenance.md)
- [Storage map](storage.md)
- [Importing a project (user guide)](../user-guide/importing-a-project.md)
- [Projects & pipeline (user guide)](../user-guide/projects-and-pipeline.md)
