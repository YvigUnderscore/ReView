# ShotGrid (Flow Production Tracking) integration

> Updated: 2026-08-21

Link a ReView project to a ShotGrid project and keep both in step: sequences, shots,
assets, tasks, statuses, schedule and published media flow into ReView, while review
decisions, statuses and dates flow back.

> ShotGrid was renamed **Autodesk Flow Production Tracking**. This guide uses
> "ShotGrid" throughout, as the API and URLs still do.

---

## 1. Before you start

You need a **ShotGrid site address** (`https://yourstudio.shotgrid.autodesk.com`) and
credentials. Two kinds are supported.

### Script key — recommended

A service account created once by a ShotGrid administrator. It survives password
rotations and people leaving, and its actions are attributable in the ShotGrid event
log.

1. In ShotGrid, open **Admin → Scripts**.
2. Create a script, for example `review_sync`.
3. Copy the **Script Name** and the **Application Key** — the key is shown once.
4. Give the script a permission group that can read (and, if you want write-back,
   update) Shots, Assets, Tasks, Versions, Notes and Playlists.

### User login — the Prism-style option

The same approach as the Prism ShotGrid plugin. It is offered as a fallback, but it is
more fragile: it ties the integration to one person's account.

Since the migration to Autodesk Identity, an Autodesk password does **not** work for the
API. Each user must:

1. Enable **Legacy Login** and set a legacy password in
   `https://<your-site>/page/account_settings`.
2. Generate a **Personal Access Token** from the Autodesk profile page.
3. Paste that token into the **Token Code** field of the same ShotGrid page and bind it.

Only then do the login and legacy password work against the API. Note that repeated
wrong passwords lock the ShotGrid account.

---

## 2. Registering a site

Sites are managed studio-wide in **Administration → Communications → ShotGrid**, or
created on the fly from a project. Credentials are encrypted at rest and never returned
by the API — editing a site leaves secret fields blank, and only what you type replaces
the stored value.

The site address must be public HTTPS. Addresses pointing at private networks are
refused, so that no one can make the server probe internal services. Rejected forms
include plain HTTP, `localhost`, `*.local`, RFC 1918 and carrier-grade NAT ranges, and
IPv6 loopback / unique-local / link-local literals. Only the origin is kept: a path or a
trailing slash is stripped before storage.

---

## 3. Linking a project

Open a project, then **Settings → ShotGrid**. The **ShotGrid** tab appears only once the
project is linked: a studio that does not use ShotGrid never sees the integration.

1. Choose the site.
2. Search the target project **by name** and select it.
3. Confirm.

The name matters. A studio site hosts every project, often with similar names
("Demo Project", "Demo Project 2"). ReView records both the id and the name, re-checks the
name before every synchronisation, and stops if it no longer matches — a renamed or reused
id halts the sync instead of writing into the wrong project. The comparison ignores case
and surrounding whitespace, nothing else.

**Template projects are refused at link time.** A site usually keeps one or more projects
that every new project is cloned from (`Template Project`, `_template_show`,
`zzz_template`…). Writing into one does not break a project — it breaks every project
later derived from it, and nobody makes the connection for months. Names matching the
template patterns are rejected with an explicit message, and the same check runs again
before any write, in case the id was typed by hand or the project was renamed afterwards.

**A freshly linked project reads but does not write.** Every domain is opened for reading
and closed for writing, and `On publishing in ReView` starts at *Do nothing*. Nobody has
yet verified that the target is the right one, and a production site does not forgive a
first synchronisation that writes. Open the write columns explicitly, once you have looked
at a first comparison.

---

## 4. The permission matrix

**Settings → What is exchanged** is a grid of seven rows and two columns: what ReView
reads from ShotGrid, and what it writes back. Each cell is an independent switch.

| Domain (row) | Read brings in | Write sends back | Default on a new link |
|---|---|---|---|
| **Sequences, shots, assets** (`hierarchy`) | codes, descriptions, cut ranges (`sg_cut_in`/`sg_cut_out`), sequence and shot statuses, asset types, asset↔shot and asset↔sequence links | shot statuses, sequence statuses, asset↔shot / asset↔sequence links | read on, write **off** |
| **Tasks** (`tasks`) | name (`content`), pipeline step, status, start/due dates, duration, assignees | status, start + due dates, assignee | read on, write **off** |
| **Status list** (`statuses`) | the exact statuses of your site — code, display name, colour, order, per entity type | *never* — reference data | read on, write **never** |
| **Versions and published media** (`versions`) | versions, their media, first/last frame, `PublishedFile` paths | review decisions, versions created by publishing in ReView, thumbnails, optionally the media file | read on, write **off** |
| **Notes** (`notes`) | ShotGrid notes as ReView comments | ReView comments as notes, with the annotated frame attached | read on, write **off** |
| **Playlists** (`playlists`) | dailies playlists | dailies playlists, ordering included | read on, write **off** |
| **People** (`users`) | `HumanUser` records, matched to ReView accounts by email address | *never* from a synchronisation | read on, write **never** |

Two rows are read-only by design. ReView does not redefine a studio's status vocabulary on
its own site, and a synchronisation never creates a ReView account — bringing people in is
a separate, explicit gesture (see [§6](#6-bringing-the-crew-into-review)).

### Which local action writes what

Every write is queued as a job, and each job type is governed by exactly one row of the
matrix. This is the whole mapping:

| Local action | Job | Governed by |
|---|---|---|
| Change a task status (task page, kanban, right-click, bulk, API v1) | `task-status` | Tasks |
| Change a task's start or due date | `task-dates` | Tasks |
| Assign a task, or assign a shot/asset through its tasks | `task-assignee` | Tasks |
| Change a shot status | `shot-status` | Sequences, shots, assets |
| Change a sequence status | `sequence-status` | Sequences, shots, assets |
| Attach an asset to shots or sequences | `asset-links` | Sequences, shots, assets |
| Record a review decision (approved, retake…) | `version-status` | Versions and published media |
| Publish a media in ReView | `version-publish` | Versions and published media |
| Post a comment on a review | `comment` | Notes |
| Change a dailies playlist | `playlist` | Playlists |

Task dates travel together in a single request. ShotGrid ties `start_date`, `due_date` and
`duration`: sending one alone makes the site recompute the other from a duration that no
longer applies.

Assignment is only pushed when the ReView account has a matching ShotGrid person. Without
that link nothing is written at all — clearing `task_assignees` on the site would be worse
than leaving it stale.

### When a write is refused

A write whose domain is closed is **not** silently dropped. Before the job runs, the
refusal is counted on the connection (domain, count, timestamp, job type) and logged at
`info` level. The **Synchronisation** section then shows a banner:

> Some changes were not sent to ShotGrid: writing is turned off for *Tasks*, *Notes*. Turn
> it on in Settings for them to go through.

This is the shape of the most common support request on the whole integration: a
supervisor changes a status, sees it applied in ReView, and cannot understand why the site
does not move. The banner answers it without reading a log.

The banner reports a **current** problem, not history: re-opening a domain for writing
clears its counter immediately, in the same request that saves the settings. Only the five
writable domains can appear there — *Status list* and *People* have no write side.

Resolving a conflict in favour of ReView goes through the same check up front, so the
panel can say *"Conflict closed, but nothing was sent"* instead of announcing a write that
will not happen.

### Editing the matrix safely

Two behaviours protect the write columns.

- **Partial saves merge one level deep.** The interface sends only the section you
  touched. A flat merge would re-parse the whole `domains` object with its schema defaults
  — where every domain is read *and* write — so ticking one box re-opened the other six
  towards a production site. `versionStatusMap` is still replaced wholesale: a mapping you
  removed must disappear, not survive the merge.
- **Unreadable settings fall back closed.** If the stored JSON cannot be validated
  (schema changed, corrupted value), ReView falls back to a read-only configuration rather
  than to the schema defaults. Sections that validate on their own (`media`, `push`,
  `reconcile`, `steps`, `versionStatusMap`, `conflictPolicy`) are kept, and each domain is
  re-integrated with its `read` value but `write: false`.

### Field notes

- **Duplicate codes**: a site may hold several entities with the same code (four sequences
  named `DO_NOT_USE_`, say). ReView can only hold one per code, so the extra ones are
  imported with their ShotGrid id appended — `DO_NOT_USE_ (4686)`. The suffix is stable,
  the comparison ignores it, and a name is only "adopted" by an entity that created before
  the link and is not already the counterpart of another remote entity.
- **Cut ranges**: `sg_cut_in` / `sg_cut_out` become the shot's start and end frames.
- **Task duration**: ShotGrid stores working minutes (2400 = five 8-hour days). ReView
  keeps the raw value alongside the link and displays working days.
- **Statuses**: imported with their site colours (ShotGrid encodes them as decimal RGB),
  their display names and their per-entity validity — a sequence may offer four statuses
  where a shot offers fifteen, and ReView keeps those lists separate so it never offers a
  value the site would refuse.
- **Pipeline steps**: ShotGrid restricts the steps offered on a project but exposes that
  setting nowhere in its REST API. Declare them once under **Pipeline steps used by this
  project**; leave the list empty and ReView infers them from the tasks already present.

---

## 5. Creating entities

By default, **creating sequences, shots and assets in ReView is refused** on a linked
project: the request returns a link to the matching ShotGrid form, pre-filled with the
right project. This keeps ShotGrid the single place where production structure is
decided.

Turn off *Create in ShotGrid only* in the settings if your studio prefers the opposite.

The same reasoning applies one level down. Assigning an asset from the right-click menu
writes on its **tasks**, because that is where a responsible person lives on both sides
(`task_assignees` is a field of `Task`). On a project driven from ShotGrid, a missing task
is *not* created locally — it must be born on the site, or the next synchronisation would
see two.

---

## 6. Bringing the crew into ReView

Linking a project brings in its shots, tasks and media — but not the people. The
**Members** tab of a linked project therefore offers **Load the ShotGrid crew**: the list
comes from `Project.users` of the linked project, not from the whole site directory.

Each person shows one of four states:

| State | What it means | What inviting does |
| --- | --- | --- |
| Project member | Already has access here | Records the ShotGrid link, nothing else |
| Has an account | Same email address exists in ReView | Adds them to this project |
| No account yet | Nobody in ReView uses this address | Creates the account, emails the invitation, adds them to the project |
| Cannot be invited | No email, or disabled on the site (`sg_status_list` other than `act`) | Nothing — the row is not selectable |

New accounts are created as **artists**. Promote afterwards, explicitly: an account that
starts as a supervisor is one nobody decided to make a supervisor.

Four rules worth knowing:

- **Creating accounts is reserved to administrators and studio supervisors** — the global
  role, not the project one. A supervisor *of a project* can add people who already have
  an account, but cannot mint new ones; the administration screen does not let them
  either, and going through ShotGrid must not be a way around it. The whole batch is
  refused up front if it contains a creation the actor may not perform, rather than
  creating three accounts and failing on the fourth.
- The invitation goes through the usual circuit. **Without a configured mail relay
  nothing is sent**, and the panel says so before you click: an account created without
  its activation email is reachable by nobody and holds the address hostage.
- Email matching is **case-insensitive**. An account stored as `Alice@studio.example`
  would otherwise look absent, and inviting it would collide with the unique index.
- Two `HumanUser` records sharing one address (common on old sites) are collapsed to one
  row, keeping the active one.

The ShotGrid link is recorded at the same time — for people who are already members too,
where it is often missing. It is what lets ReView write to the site *on that person's
behalf* rather than as an anonymous "ReView".

**Typical use.** A new show starts. The coordinator links the project, opens **Members →
Load the ShotGrid crew**, selects everyone with a green *No account yet* state, and clicks
**Give ReView access**. The panel announces the plan first ("6 accounts to create, 2 to add
to the project"), so nobody creates twenty accounts by accident.

---

## 7. Staying up to date

Three mechanisms work together. You are not expected to choose one and hope.

### Webhooks (near-instant)

Copy the address shown in the settings, then in ShotGrid:

1. Open **Admin → Webhooks → Create Webhook**.
2. Paste the URL.
3. Filter on **the linked project** and on the entity types you care about (Shot,
   Sequence, Asset, Task, Version, Note, Playlist).
4. Set the **secret token** to the one shown in ReView.

ReView answers within milliseconds and processes in the background — ShotGrid requires a
reply within six seconds and counts response time against a site-wide budget.

An event is treated as a **doorbell, not as data**: its payload is capped at one megabyte
and truncated beyond that, so ReView only reads *which* entity to re-read, then re-reads it
from the API. That is also why webhook mode and polling mode behave identically.

Events on the same entity are coalesced over a 5-second window. Changing the status of a
hundred tasks in one ShotGrid action produces a hundred events but one re-read per entity.

The address can be renewed at any time; the previous one stops working immediately.

### Polling

If your ReView instance is not reachable from the internet, switch the update mode to
**periodic polling**. ReView reads the ShotGrid event log from its last processed entry.
Slightly delayed, but it needs no inbound connection.

Changing the mode, the polling interval or the catch-up hour takes effect **immediately**:
saving the settings re-lays the repeatable jobs. No restart, no deployment.

### Catch-up after downtime

Neither of the above survives everything: an instance can be stopped for a night, and
ShotGrid disables a webhook endpoint after a hundred failed deliveries, keeping delivery
logs for only seven days.

So ReView also re-reads a **look-back window** — nightly, and when the instance starts.
Set the window to cover the longest outage you want to survive (72 hours by default).
The window starts from the last successful synchronisation, never from "now": an instance
stopped for a week re-reads that week, not the last 72 hours.

At boot, catch-up passes are delayed ten seconds and staggered fifteen seconds apart, so
restarting an instance with a dozen linked projects does not hammer the studio site.

### Concurrent synchronisations

One pass at a time runs per connection. A request that arrives while a pass is running is
**merged into a pending request and replayed when the current pass ends** — it is never
dropped.

This used to be the single largest cause of "some statuses do not come through". Each
webhook is its own job, the worker runs several at a time, and a request arriving during a
pass was discarded *and reported as successful*. Ten simultaneous status changes on the
site lost roughly half of themselves, with no error and nothing for the queue to retry.

The merge never narrows the scope:

| Field | Merge rule |
|---|---|
| `kind` | `full` if either side is full, otherwise the newer one |
| `since` | the earlier of the two dates; **null** (meaning "everything") as soon as one request has no window |
| `onlySgIds` | the union, de-duplicated — but dropped entirely (meaning "the whole project") as soon as one request is not targeted |
| `withMedia` | true if either side wants media |

A deferred request is reported as such rather than as a success. Clicking the
re-read dot next to an entity while a pass is running answers *"A sync is already running —
this re-read is queued behind it."*

---

## 8. Comparing both sides

The **Comparison** section reads both sides live and lists every difference, without
changing anything:

- present in ShotGrid, missing in ReView;
- present in ReView, gone from ShotGrid;
- values that diverge, field by field;
- local entities that were never linked.

Compared fields, per entity:

| Entity | Fields compared |
|---|---|
| Sequence | code, status |
| Shot | code, start frame, end frame, status |
| Asset | presence only |
| Task | name, status, start date, due date |
| Version | review decision, against the version status mapping |

The header also re-checks the remote project name and says so loudly if it no longer
matches. Trashed local entities are ignored — they are not gaps. The report is capped at
500 entries and says when it was truncated; the counters above it stay exact.

Use **Realign on ShotGrid** to run a full synchronisation and close the gaps. It is a
separate, explicit action, because overwriting work should be decided rather than
happen quietly.

**Typical use.** The instance was down for two days over a long weekend, past the look-back
window. On Monday: open **Comparison**, check that the counters differ only where you
expect (a handful of new shots), then **Realign on ShotGrid**.

---

## 9. Published media

New ShotGrid versions carrying media are imported automatically and enter the normal
ReView pipeline (transcoding, thumbnails, frame-accurate review). You can:

- choose between the **ShotGrid transcode** (lighter) and the **original file**;
- cap the size above which media is skipped and logged;
- restrict the automatic import to certain statuses;
- import anything else on demand from the **Published media** section.

A version whose ShotGrid task is unknown to ReView is attached to a per-shot task named
`ShotGrid`, rather than being dropped.

The link between the ShotGrid version and the ReView version is written **before** the
media transfer is attempted. It states a fact that is already true — "this version is in
ReView" — and without it a failed download left an orphan that the next pass re-created,
once per pass, indefinitely.

### The status filter imports; it does not freeze

The status filter decides what gets **imported**, not what gets **tracked**. A version
already in ReView keeps having its metadata and its review decision refreshed even when
its status moves outside the filter — going from *in review* to *approved* must not stop
the decision from reaching ReView. What the filter still prevents on such a version is
re-fetching its media. A manual selection from **Published media** overrides the filter
entirely: it is an explicit decision.

### Media names

An imported media takes the **code of its ShotGrid version** — `SH010_comp_v003.mov` —
rather than the name of the attached file. That code is what production reads in its
playlists and says out loud in dailies, so both tools name the same thing the same way.
The extension always comes from the delivered file (or its content type), never from the
code: it is what tells ReView how to validate, transcode and play the file.

The delivered file name is not lost. It is kept and shown as **Source file** in the
technical sheet of the review — a studio naming convention often carries information the
code does not repeat (colour space, encoding, retake marker).

Two details worth knowing:

- Media imported before this behaviour existed are renamed on the next synchronisation
  that reads their version. Nothing to migrate, nothing to click. The rename is idempotent
  and only touches media flagged as imported from ShotGrid.
- A file dropped into ReView by hand is **never** renamed, even on a linked project.

Set **Media name** to *Delivered file name* in the settings if your studio would rather
keep the file names as they arrive.

### Version names created in ReView

On a linked project, the next version created in ReView **imitates the most advanced
sibling that already carries a site-style code** rather than guessing a convention:
project prefix, the case of the `v`, and the width of the zero padding are all copied.
`NEBULA_SH010_anim_v007` therefore yields `NEBULA_SH010_anim_v008`, not `V08`.

With no such sibling, ReView falls back to the usual ShotGrid shape,
`<parent>_<step>_v001` — and to the short `V01` form when the parent cannot be identified,
since `_anim_v001` designates nothing. Numbering always continues above the highest number
ever used under that parent, trashed versions included: counting the survivors would
produce a second `v003` for different work.

Pausing a connection does not change any of this. A paused project is still a linked
project; the naming convention should not change shape because synchronisation was
suspended for an afternoon.

---

## 10. Writing back

- **Review decisions** update the ShotGrid version status through the status mapping. If
  the mapping has no entry, ReView re-derives the code by matching status names against the
  site's valid values — read-only, creating nothing. Without that second path, un-ticking
  *Status list → read* was enough to silently stop every review decision from leaving.
- **Task statuses, dates and assignments** are pushed when the matching domain is open
  for writing.
- **Publishing in ReView** creates a ShotGrid version — either with a link back to the
  ReView review (default, no duplicated storage) or with the media file uploaded.
- Changes are attributed to the ReView user when their email matches a ShotGrid account
  (*Write under the ReView user's name*). Otherwise the write is made by the script
  account.

Writes go through a queue: a ShotGrid outage never makes a local action fail. What could
not be written is logged, and the catch-up pass closes the gap.

### Publishing modes

| Mode | What lands on the site | When to choose it |
|---|---|---|
| **Create a version with a link** (default) | A `Version` with the code, description, task and entity links, a thumbnail, and `sg_path_to_movie` pointing at the ReView review | ReView is where review happens; dailies masters are not duplicated |
| **Create a version and upload the file** | The above, plus the media in `sg_uploaded_movie`, which triggers ShotGrid's own transcode | ShotGrid must be self-sufficient (external partners, archival) |
| **Do nothing** | Nothing | Reading only |

Uploads above **2 GB** are skipped with a warning; the version still exists on the site
with its link and thumbnail. The thumbnail is always sent first: it is small, and it makes
the version recognisable in ShotGrid lists even when the file itself stays here.

*Do nothing* is the state of a freshly linked project, so the Synchronisation section shows
a standing notice while it lasts — otherwise versions publish here, nothing goes there, and
nobody finds out until someone looks for them on the site.

### Never creating a duplicate Version

Before creating a version, ReView searches the linked project for one carrying the same
code. The case is common: the artist's render tool already created
`NEBULA_SH010_comp_v004` on the site before they published in ReView. When exactly one
match exists, ReView attaches to it — uploading the thumbnail, and the file in upload mode
— instead of creating a twin the site cannot tell apart.

Two edge cases, both deliberate:

- **Two homonyms on the site**: ReView attaches to neither and creates its own version.
  Attaching to the wrong one costs more than one extra version a human will notice.
- **The version already has a link**: adding a media to a version in progress enriches
  *that* version rather than making a second one.

Whenever ReView creates or adopts a version this way, the link is marked as "media already
here", so the next synchronisation does not download back the file that was just sent.

---

## 11. Conflicts

A conflict is declared when a field changed on **both** sides between two
synchronisations. Both conditions are required:

1. the ReView entity was modified after the link was last synchronised (with one second of
   tolerance — a local write and the link timestamp are never simultaneous to the
   millisecond); **and**
2. the two values actually differ.

The second condition matters more than it looks. `updatedAt` moves for any change to the
entity, so ticking a checklist item on a task used to declare a *status* conflict, and the
log filled up with lines reading "review: ip, shotgrid: ip".

### The three policies

Set under **Settings → Conflicts → When both sides changed**. All three are applied.

| Policy | What happens to the field | What is logged |
|---|---|---|
| **ShotGrid wins** (default) | The site value replaces the ReView value | `ShotGrid won: the ReView value was replaced` |
| **ReView wins** | The ReView value is kept **and queued back to the site** | `ReView won: its value was sent back to ShotGrid` |
| **Ask a human** | Nothing changes on either side; the line waits for a decision | `Nothing was changed: choose a side below` |

Only the **disputed field** is withheld. Names, cut ranges, dates and parent links are not
in conflict and keep flowing down from the site regardless of the policy.

The log message is written *after* arbitration, not before. It used to interpolate the
policy into a sentence that always claimed an overwrite — so it could print "review_wins"
in the very line where it overwrote the local value.

### Resolving by hand

Under **Ask a human**, open conflicts are listed at the top of the **Synchronisation**
section with the field name and both values in plain sight, and two buttons:

- **Keep ShotGrid** — re-reads that single entity from the site and applies it.
- **Keep ReView** — restores the ReView value recorded on the conflict line, then queues
  the corresponding write. The restore step is necessary because under *ShotGrid wins* the
  local value has already been replaced, and the conflict line is the only place the
  original survives.

Neither button merely marks the line as read. Closing a conflict without acting would
leave the gap intact and let it come back at the next pass.

If the matching domain is closed for writing, **Keep ReView** says so instead of
announcing a write that will not happen.

---

## 12. Unknown status codes

A status code is "unknown" when the site sends a value that is not in the list ReView
imported for that entity type. This happens in ordinary circumstances: *Status list → read*
turned off, the site schema momentarily unreadable, or a code retired from
`valid_values` while entities still carry it.

Three inputs, three distinct outcomes:

| The site sends | ReView does |
|---|---|
| An empty status | Clears the local status — the site deliberately emptied it |
| A known code | Writes the matching status |
| An unknown code | **Keeps the local status** and logs a warning |

The warning is emitted once per (entity type, code) and per run: a full pass over three
thousand shots would otherwise write three thousand identical lines.

The same reasoning protects review decisions. A ShotGrid version status with no entry in
the version status mapping leaves `reviewStatusId` untouched. Writing it unconditionally
erased the human decision — approved, retake — on every pass, with no conflict and no
trace. It is the single most expensive value to overwrite in the whole integration.

When the status reference cannot be read at all, ReView falls back to the statuses it has
already imported from a site (`origin = shotgrid`, studio-level). That filter is not
cosmetic: without it the fallback also picked up the studio's own local vocabulary and
other projects' statuses, and a common code such as `ip` was enough to stamp a shot with a
neighbouring project's status.

Statuses that disappear from the site are **kept**, not deleted, and reported once — a
ReView task may still carry one, and stripping its status would be worse than keeping a
stale entry.

---

## 13. Site-specific limits

Sites differ, and some restrict what an account may write. Two cases met in the field:

- **`note_links` refused.** When the site does not allow writing note links, ReView
  still posts the note, with the version name in the subject and a link back to the
  ReView review. Ask a ShotGrid administrator to grant the permission if you want notes
  attached to their version.
- **Status codes outside the standard lists.** Studio codes such as `rtk`, `pass` or
  `suprev` are imported like any other: ReView keeps the site's own code, name and colour.
  Only the *legacy* task enum kept for backwards compatibility falls back to `TODO` when a
  code is not recognised; the pipeline status shown in the interface is the site's. Codes
  are also classified for the progress gauges — `omt`, `dis`, `ign`, `na`, `dcl` count as
  neither work to do nor work done, so an omitted shot does not inflate a production's
  remaining work forever.

---

## 14. What cannot be undone

Two mistakes have no recovery path from inside ReView. Both have dedicated guards.

**Writing into the wrong project.** A ShotGrid site hosts every project of the studio, and
a forgotten filter does not look like a bug — it just imports the neighbour's project over
yours.

- Every search carries the project filter (`['project', 'is', {Project, id}]`).
- Every record received is re-checked with `belongsToProject` before being used. Entities
  that legitimately have no project (`HumanUser`, `Status`, `Step`, `Department`, `Group`,
  `PublishedFileType`, `ApiUser`) are listed explicitly rather than accepted by default; a
  project entity whose `project` field is unreadable is refused, never guessed.
- Every write re-reads its target and re-checks ownership before touching it — a link may
  point at an entity deleted and re-created under the same id elsewhere.
- Every write also re-checks that the target is not inside a template project.
- The remote project name is compared before each synchronisation; a mismatch halts it.

A record that fails the check is skipped, counted under `guard`, and logged as an error
with both project ids. This should never fire — which is exactly why it exists.

**Creating a duplicate Version.** A site cannot tell two identically named versions apart,
and the duplicate has to be deleted by hand over there. The homonym search described in
[§10](#never-creating-a-duplicate-version) is what prevents it, together with the
"media already here" marker that stops a just-uploaded file from being downloaded back.

---

## 15. Troubleshooting

| Symptom | Cause | What to do |
|---|---|---|
| A status changed in ReView never appears on the site | The domain is closed for writing | Look for the *"Some changes were not sent"* banner under **Synchronisation**, then open the matching write column in **Settings** |
| …and the banner is not there | The entity has no ShotGrid link (created locally, never synchronised) | Hover the sync dot next to it — an amber dot reads *Not in ShotGrid — created here only*. **Comparison** lists it as *Not linked* |
| …and the entity is linked | The write left but the target moved | Check the run log for *"belongs to project #…"* or a template-project refusal |
| A status changed on the site never appears in ReView | Unknown status code | Search the log for *Unknown status code* — add the code to the site's valid values, or re-read the status list |
| Some statuses come through, others do not, with no error | Several passes competed | Fixed: requests are merged and replayed. If it persists, check that the run log shows one run per burst rather than none |
| A review decision keeps reverting after each sync | The site's version status has no entry in the mapping, and used to blank the decision | Fixed: the decision is now left alone. Map the code under **Settings** if you want it driven from the site |
| *"ReView wins" behaves like "ShotGrid wins"* | The policy was never read | Fixed. Verify the log line: it now names the actual outcome |
| Conflicts pile up on entities nobody touched | Any edit moved `updatedAt` | Fixed: a conflict now requires the values to actually differ |
| A conflict says *"Divergence recorded before the values were captured"* | The line predates value capture | Synchronise again; the next occurrence carries both values |
| **Keep ReView** reports *"nothing was sent"* | That domain is closed for writing | Open the write column, then resolve the conflict again |
| *Authentication refused* | Wrong script name/key, or in user mode: Legacy Login not enabled, or the Personal Access Token not bound | Re-enter the credentials on the site record |
| *Remote project name changed* | The linked project was renamed, or its id reused | Confirm the target on the site, then unlink and relink |
| No events arriving | Webhook disabled after 100 failures, wrong secret, or ReView not reachable | Check the webhook status in ShotGrid; switch to **periodic polling** if the instance is not public |
| Polling interval changed but nothing happened | *(historical)* the schedule was only laid at boot | Fixed: saving the settings re-lays the repeatable jobs |
| Media not imported | No media on the version, over the size limit, or outside the status filter | Read the run log — each case has its own line |
| A version's media is not refreshed although its status is | The version is already imported but its status left the filter | Expected. Import it explicitly from **Published media** |
| Two identical versions on the site | Two homonyms already existed, so ReView attached to neither | Delete one on the site, then re-publish |
| A shot exists in ReView but nowhere in ShotGrid | Created locally before the link | The comparison lists it as *Not linked* |
| An entity disappeared from ReView | Moved to the ShotGrid bin — deletion happens there and propagates here | Restore it in ShotGrid and re-synchronise; the ReView entity is only trashed, with its history |
| A task deleted in ShotGrid is still in ReView | It carries versions, and deleting it would delete that review work | Move the versions elsewhere, then re-synchronise |
| The comparison shows more tasks or versions in ReView | Tasks kept as above, or local versions never pushed | Check *publish mode* |
| Annotations not attached to notes | Media file missing from storage, or the site refuses `Note.attachments` | Check the run log; ask a ShotGrid administrator for the permission |
| Media are named after the delivered file, not the version code | *Media name* is set to *Delivered file name*, or the version has not been re-read yet | Switch the setting; names realign on the next pass |
| A crew member cannot be selected | No email address, or disabled on the site | Fix it on the site, then reload the crew |
| **Give ReView access** is disabled | No mail relay configured | Configure [SMTP](smtp-and-announcements.md) first |

Every synchronisation is recorded with per-domain counters and a filterable log (info,
warning, error, conflict), kept under **Synchronisation**. Log lines are stored as message
keys with their variables, so a run from six months ago reads in the language of whoever
opens it.

---

## 16. Development without a ShotGrid site

The repository ships a simulator that reproduces the API surface ReView uses:

```bash
node scripts/fake-shotgrid.mjs --port 8890
```

It exposes three projects, two of which deliberately carry entities with identical
codes — the fixture that proves synchronisation never spills into a neighbouring
project — and gives each project a distinct crew, so the four crew states can be
exercised. Point a site at `http://localhost:8890` with script `review_sync` and key
`dev-script-key-0000`, after allowing the host:

```bash
SHOTGRID_INSECURE_HOSTS=localhost:8890
```

That variable lifts the HTTPS and private-network checks for the listed hosts only. It
is empty by default and logged loudly at startup — a real ShotGrid site never needs it.

The end-to-end scenario runs with:

```bash
node scripts/test-shotgrid-e2e.mjs
```

## Related pages

- [Users & roles](users-and-roles.md)
- [SMTP & announcements](smtp-and-announcements.md)
- [Pipeline settings](pipeline-settings.md)
