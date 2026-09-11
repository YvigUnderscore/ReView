# Review decisions & approvals

*Recording what a review concluded on a version — customisable statuses, a history that never changes, and who was asked to look.*

> Updated: 2026-09-11

A **review decision** is the studio's answer to one question: what did we conclude about
this version? It is deliberately distinct from the task's kanban status. The kanban says
*where the work is*; the decision says *what the review concluded*. A shot can sit in
`In progress` on the board while its v01 carries a retake and its v02 an approval — those
are two different facts, and conflating them loses both.

Decisions drive the approval circuit — pending, retake, new version, approved — and every
one of them is kept. Nothing overwrites anything.

![v01 is uploaded, published, sits at the studio default status, then takes a Retake decision whose comment says what has to change; v01 keeps that decision forever, while v02 travels the same chain and is approved.](../assets/user-guide/approval-circuit.svg)

## The studio's vocabulary of statuses

Decision statuses are **customisable per studio**, in *Admin → Review contexts →
Statuses*. A fresh instance creates the classic set on first access:

| Status | Colour | Flags | Meaning in the shipped set |
|---|---|---|---|
| **Pending** | `#F5A623` amber | *default* | Nothing has been concluded yet |
| **Approved** | `#2ECC71` green | *approval* | Good to go |
| **Retake** | `#E74C3C` red | *retake* | Back to the artist |
| **CBB** | `#3498DB` blue | — | Could be better: accepted, with reservations |

Each status carries a name (**40 characters maximum**), a hex colour `#RRGGBB`, an order
in the list, and up to three flags:

| Flag | What it controls | Constraint |
|---|---|---|
| *default* | The status pre-selected when a version has no decision yet | **One at a time** — setting it on one status clears it everywhere else |
| *approval* | What downstream integrations read as "good to go" | Any number of statuses may carry it |
| *retake* | What downstream integrations read as "do it again" | Any number of statuses may carry it |

The approval and retake flags are what leaves the application — the webhook payload, the
ShotGrid push, the badge colouring logic. Put them on the statuses that really mean those
two things, whatever you decided to call them. A studio that renames *Approved* into
*Final delivery* keeps every integration working, as long as the flag travels with the
name.

> [!IMPORTANT]
> Creating, editing, reordering and deleting statuses is reserved to `ADMIN` — the routes
> behind the Statuses tab require that role, not merely supervision of a project. Reading
> the list is open to everyone: it feeds badges and filters for the whole studio.

A status that has already been used by a decision **cannot be deleted**. The request is
refused with *This status is used by N decision(s) — it cannot be deleted*, and the count
tells you how much history depends on it. Rename it instead, or move it to the end of the
list to take it out of circulation; existing decisions keep pointing at it and stay
readable.

### On a project linked to ShotGrid

The picker only offers the statuses that have a **mapping** on the site. Posting a
decision the remote site does not know would go nowhere, and mixing two vocabularies gives
you two "approved" and three "retake" in the same list. The restriction applies when the
connection is active *and* a version status mapping exists; a standalone project, or a
connection with no mapping yet, keeps the full set. See
[ShotGrid integration](../admin-guide/shotgrid-integration.md).

## Taking a decision

Two surfaces, and no button anywhere else — the interface stays uncluttered by putting the
gesture where the version already is:

| Where | Gesture | Notes |
|---|---|---|
| A **version card**, on a task or asset page | Right-click → *Review decision…* | The entry reads *Decision history…* if you cannot decide |
| The **review header**, while reviewing a media | The clipboard button | It carries the version's current decision as a badge |

Both open the same dialog:

- the **current decision** at the top, as a coloured badge, or *No decision yet*;
- the available statuses as **coloured chips**, pre-selected on the current decision, or
  on the studio default when there is none;
- an optional **comment**, up to **2000 characters**, kept visible in the history;
- *Set the decision*, and below it the full history, newest first.

Deciding is reserved to supervision. The chips are shown to `SUPERVISOR` and `ADMIN`;
everyone else opens the same dialog and reads the history — which is the point, the record
is public even though the act is not. On the API side the check is finer: it uses your
**effective role on that project**, so a member promoted to supervisor on this project
alone is allowed to decide there. See
[per-project roles](../admin-guide/project-organization.md#per-project-roles).

> [!TIP]
> During a live review session the clipboard button stays available, so decisions can be
> dispatched as the room walks the playlist. See
> [Playlists & live review sessions](playlists-and-live-review.md).

## Handing a version to someone

A decision says what was concluded. It says nothing about the step before it: **who was
asked to look**. That request used to live in a corridor conversation or a chat thread, so
nobody could open ReView and answer "what is waiting on me?".

The same dialog carries it. Under the statuses, a **Reviewers** line shows the people the
version was handed to and **the brief written for each of them**; a supervisor opens the
studio directory from *Assign*:

- clicking a name **hands them the version**; clicking it again **takes it back**. There is
  no *Save* — a checklist you can leave without validating lies about its own state;
- beside each name sits a **brief**: one line saying what that person should look at. It is
  saved when you leave the field, `Escape` puts back what was there, and it can be written
  or rewritten at any time — this is where a forgotten one is caught up;
- the directory is the **project's members**, searchable by name, address, job title or
  role. Service accounts and clients are not offered, and the server refuses them too:
  a machine identity does not watch dailies, and a client comments rather than reviews;
- up to **20 people** on one version. Past that it is not an assignment any more, it is a
  screening — that is what a [playlist](playlists-and-live-review.md) is for.

### The brief, and what a studio can demand of it

"Look at this" and "look at the cut at 1042, the rest is signed off" do not ask for the same
work. Knowing you are expected without knowing **at what** only saves time for the person
who assigned it: the recipient opens four minutes of playblast with no idea which of three
things is being asked.

The brief is **per person, not per version**. "The lighting" to the lighting lead and "the
cut at 1042" to the editor are two different requests, and squeezing both into one field
makes neither readable.

*Project → Settings → Brief for the ReViewer* decides how strict the studio is: the brief
can be **required**, with a **minimum length** (5 characters by default, so "ok" does not
count). See [Pipeline settings](../admin-guide/pipeline-settings.md#the-brief-a-reviewer-is-owed).
When it is required, clicking a name does not hand the version over straight away — it puts
the person on hold while you write. Handing over first only to be refused afterwards would
be a false promise.

Whoever is handed the version sees the brief written for them **at the top of the review**,
above the viewer, the moment they open the media. They do not have to go looking for it.

### Saying it at the moment you deliver

The dialog above is the supervisor's place, after the fact. The person who just delivered
has one of their own: **Publish** — from the review, or the ✚ beside *Publish* in the
**Pending drafts** pill — opens *Publish and hand over the review*, where names and briefs
are composed and the whole thing goes out in one gesture.

The author of a version may hand over its review, exactly like a project manager. It is
what makes "require a brief at upload" a rule the uploader can actually satisfy — and the
artist who just delivered is the person who knows what there is to look at. It grants
nothing else: the decision is still supervision's.

Publishing without naming anyone stays a one-click gesture. The rule only fires once a name
is attached.

Assigning **grants nothing and removes nothing**. It is an expectation, not a delegation:
the decision stays reserved to supervision, and an artist handed a version reviews and
comments exactly as they already could. Reading the list is open to every project member,
as the decision history is.

Each person newly handed the version gets a **notification** that opens straight onto the
review screen, and starts **following** the version — the comments and the decision that
follow are precisely what they are waiting for. Rewriting someone's brief notifies them
again but does **not** re-subscribe them; taking someone off the list does not unfollow
them either. Both are theirs to decide, and they may have chosen already.

> [!NOTE]
> Assigning is written to the audit log under `version.reviewers`, with the list of people
> it was set to; rewriting a brief alone is written under `version.reviewer_note`, with no
> list — the list did not change, and saying it did would be false. Who asked whom to look
> is production history, not interface state.

## What one decision sets off

Recording a decision is not a badge change. In a single gesture it does all of this:

![A single decision appends to the version history, updates the current decision badge, writes an audit entry, notifies the author and the watchers, fires the review.decision webhook, posts a line in team messaging, and queues a push to ShotGrid on a linked project.](../assets/user-guide/decision-fanout.svg)

- appends to the version's **history**, kept forever — who, when, which status, which
  comment — newest first;
- updates the version's **current decision**: the badge you see on version cards, in the
  review header, and in the Reviews list;
- writes an entry in the **audit log**, under the action `version.decision`, carrying the
  status name and the comment;
- **notifies the version's author**, unless they took the decision themselves;
- **notifies the watchers** of the version, its shot or its asset — excluding both the
  person who decided and the version author, who already has their own notification;
- publishes the `review.decision` **event** with the status name and its approval/retake
  flags;
- posts a line in the **team messaging** channel;
- **queues a push to ShotGrid** on a linked project. It is queued rather than awaited on
  purpose: an artist should not wait for a remote site, and an outage there must not fail
  the review.

None of that modifies an earlier version. The retake you put on v01, its comment and its
date stay on v01 forever — three months later you can still read why it came back.

## Where a decision goes after that

A decision is one of the few facts in ReView that several other systems consume. It leaves
the application through three doors.

| Door | What carries the decision | Who reads it |
|---|---|---|
| **Notes export** | The `decision` column of the CSV, next to every note of the media — the version's current decision at export time | Production, in a spreadsheet |
| **Event feed** | The `review.decision` event, stored per project and delivered to subscribed webhooks | Integrations, the v1 API |
| **ShotGrid** | The `version-status` push, translated through the project's version status mapping | The show's own tracker |

The event is stored **scoped to its project**, which is what makes a per-project
subscription possible: an integration can follow one show rather than the whole studio. The
webhook payload contains the version id and name, the project id, the status name, the
`isApproval` and `isRetake` flags, the comment and the user who decided. See
[which events actually fire](../admin-guide/identity-and-api.md#which-events-actually-fire)
and [Exporting review notes](exporting-notes.md).

> [!NOTE]
> Integrations should branch on the **flags**, never on the status name. Names are the
> studio's vocabulary and change with the show; `isApproval` and `isRetake` are the stable
> part of the payload.

## Finding what is still waiting

The Reviews page opens on an **Assigned to me** panel: the versions someone handed you,
newest first, with a count and a way into the full list. It is not shown when the list is
empty — a permanent "nothing for you" frame would cost every reader what it gives the few
with a queue.

The same page carries a **decision filter** — *All decisions*, *No decision*, or any single
status — and an **assignment filter** — *All reviews* or *Assigned to me* — which combine
with the project, media type and published/draft filters. Together they answer "what is
still waiting on me" (*Assigned to me*, or *No decision* for a supervisor) and "what did we
retake this week" (the retake status).

A filter combination worth keeping can be saved from the **Saved views** menu next to the
filters, and reapplied in one click on your next pass — the assignment filter travels with
the rest.

## API

Decisions are first-class in both APIs, for a studio that drives approvals from a pipeline
tool rather than by hand:

| Call | Purpose | Who |
|---|---|---|
| `POST /api/versions/:id/decision` | Record a decision — body `statusId`, optional `comment` (2000 characters max) | Effective supervisor or admin on the project |
| `GET /api/versions/:id/decisions` | The full history of a version | Any project member |
| `GET /api/review-statuses?projectId=` | The status list, narrowed to the ShotGrid mapping when the project has one | Any authenticated user |
| `GET /api/versions/:id/reviewers` | Who the version was handed to | Any project member |
| `PUT /api/versions/:id/reviewers` | Hand the version to these people — body `reviewers: [{ userId, note }]`, 20 maximum, replaces the list | Project manager, or the author of the version |
| `PATCH /api/versions/:id/reviewers/:userId` | Rewrite one person's brief, leaving the rest of the list alone | Project manager, or the author of the version |
| `GET /api/media/reviews?assigned=me` | The media of the versions handed to you | Any authenticated user |
| `POST /api/media/:id/publish` | Publish, and hand over in the same call — body `reviewers: [{ userId, note }]` | The uploader |
| `POST /api/v1/versions/:id/decision` | The same act from a service token | Token with the `versions:write` scope, `SUPERVISOR` or `ADMIN` |
| `PUT`/`PATCH /api/v1/versions/:id/reviewers…` | Hand over from a pipeline tool | Token with the `versions:write` scope |

See [v1 integration](../api/v1-integration.md).

## Use cases

### The normal circuit

1. The artist uploads a version and publishes it.
2. The supervisor reviews the media, puts **Retake** from the clipboard button, and writes
   what has to change in the decision comment. The artist is notified.
3. The artist uploads **v02** and publishes.
4. The supervisor puts **Approved**. The badge turns green everywhere the version appears,
   the watchers hear about it, and the approval flag propagates to whatever is plugged in
   downstream.

Nothing in that circuit modifies the earlier version, which is what makes the history worth
reading later.

### Splitting a morning of dailies between two supervisors

Forty published versions, two people to look at them. From each version's decision dialog,
hand it to whoever owns that sequence — or open the sequence's versions one after another
and assign as you go. Each of them opens ReView, finds their share under **Assigned to me**,
and works down it. Nobody reviews the same shot twice, and nothing falls between the two
because it was mentioned to nobody.

### Clearing the queue on Monday morning

Open the Reviews page, filter on *No decision*, and go down the list. Every media you open
already has the clipboard button in its header, so deciding never means going back to a
task page. What is left in the filter at the end of the pass is exactly what you did not
get to. Save that filter as a view and the next pass starts in one click.

### A studio that does not say "CBB"

Some studios work with *Pending / Approved / Retake*, others with a five-step ladder,
others in their own language. Rebuild the list in *Admin → Review contexts → Statuses*, put
the *approval* flag on whatever you call "final" and the *retake* flag on whatever you call
"back to the artist", and order them the way the pipeline reads. Existing decisions keep
pointing at their status, which is why a used status can be renamed but not deleted.

### A show run from ShotGrid

Link the project, map the ReView statuses onto the site's version statuses, and the picker
narrows to that mapping. From then on the decision travels: the supervisor decides in
ReView, the queue pushes it to ShotGrid, and production reads the show's usual vocabulary.

### Handing the week's decisions to production

Export the notes of the playlist, the shot or the cut you screened. The CSV carries a
`decision` column beside every note, so the spreadsheet that lands in the production
meeting says both what was said and what was concluded, without a second pass in the
application.

## Troubleshooting

**The status list is shorter than what the admin configured.** The project is linked to
ShotGrid, and only the mapped statuses are offered. Add the mapping on the site, or in the
project's ShotGrid settings.

**"This status is used by N decision(s) — it cannot be deleted".** History wins. Rename or
reorder it; if you want it out of circulation, move it to the end of the list.

**I can open the decision dialog but not the chips.** Deciding is restricted to
`SUPERVISOR` and `ADMIN`. Everyone else gets the read-only history — which is the point:
the record is public, the decision is not.

**The person I want to hand the version to is not in the directory.** Only the project's
members are offered, minus the clients and the service accounts. Add them to the project
first — assigning someone who cannot even open the media would notify them of nothing they
can act on.

**The "Assigned to me" panel is not on my Reviews page.** It appears only when something is
actually waiting for you, and it steps aside when the list itself is already filtered on
*Assigned to me* — there it would say nothing the page does not.

**Two statuses both look like the default.** Only one can be. Setting the *default* flag on
a status clears it on every other one, so if the list still shows two, reload — the screen
is stale, not the data.

**The badge did not change on the task page.** The badge shows the *latest* decision on the
version. Reload the page if you decided from the review header in another tab.

**The author was not notified.** They are not notified when they decide themselves, and
watchers exclude both the actor and the author, to avoid sending the same person two
notifications for one event.

**ShotGrid still shows the old status.** The push is queued, not awaited. Give the queue a
moment; if it stays behind, the ShotGrid page explains how to read a refused write.

## Related pages

- [The review workspace](review-workspace.md)
- [Annotations & comments](annotations-and-comments.md)
- [Exporting review notes](exporting-notes.md)
- [Playlists & live review sessions](playlists-and-live-review.md)
- [Projects & pipeline](projects-and-pipeline.md)
- [Kanban & tasks](kanban-and-tasks.md)
- [ShotGrid integration (admin)](../admin-guide/shotgrid-integration.md)
- [Identity, API & audit (admin)](../admin-guide/identity-and-api.md)
- [Admin overview](../admin-guide/overview.md)
