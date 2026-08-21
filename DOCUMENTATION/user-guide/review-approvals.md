# Review decisions & approvals

> Updated: 2026-08-21

Supervisors and admins put a **review decision** on a version. It is deliberately distinct
from the task's kanban status: the kanban says where the work is, the decision says what the
review concluded. Decisions drive the approval circuit — pending → retake → new version →
approved — and every one of them is kept.

## Statuses

Decision statuses are **customisable per studio**, in *Admin → Review contexts → Statuses*.
A fresh instance starts with the classic set:

| Status | Colour | Flag |
|---|---|---|
| **Pending** | amber | default status |
| **Approved** | green | approval |
| **Retake** | red | retake |
| **CBB** (could be better) | blue | — |

Each status has a name (40 characters maximum), a hex colour, an order in the list, and up
to three flags: *approval*, *retake* and *default*. Only one status can be the default at a
time — setting the flag on one clears it everywhere else. The approval and retake flags are
what downstream integrations read, so keep them on the statuses that really mean "good to
go" and "do it again", whatever you called them.

Creating, editing, reordering and deleting statuses is reserved to `ADMIN`. A status that
has already been used by a decision **cannot be deleted** — the request is refused and tells
you how many decisions depend on it. Rename it instead; the history stays coherent.

**On a project linked to ShotGrid**, the picker only offers the statuses that have a mapping
on the site. Posting a decision the remote site does not know would go nowhere, and mixing
two vocabularies gives you two "approved" and three "retake" in the same list. Standalone
projects keep the full set.

## Making a decision

Two surfaces, and no button anywhere else:

- **Right-click a version card** on a task or an asset page → *Review decision…*
- The **clipboard button in the review header** while reviewing a media. It carries the
  version's current decision as a badge.

Both open the same dialog: the current decision at the top, the available statuses as
coloured chips, an optional comment (up to 2000 characters, visible in the history), and
*Set the decision*. The status is pre-selected on the current decision, or on the studio
default when there is none.

Only `SUPERVISOR` and `ADMIN` can decide. Everyone else opens the same dialog and reads the
history — the button's tooltip says *Decision history* rather than *Review decision*.

## What a decision sets off

Recording a decision is not just a badge change. In one go it:

- appends to the version's **history**, which is kept forever — who, when, which status,
  which comment — newest first;
- updates the version's **current decision**, the badge you see on version cards, in the
  review header and in the Reviews list;
- writes an entry in the **audit log**;
- **notifies the version's author**, unless they took the decision themselves;
- **notifies the watchers** of the version, its shot or its asset — excluding the person who
  decided and the version author, who already got their own notification;
- fires the `review.decision` **webhook** with the status and its approval/retake flags, for
  anything you have plugged in downstream;
- posts a line in the **team messaging** channel;
- **queues a push to ShotGrid** on a linked project. It is queued rather than awaited on
  purpose: an artist should not wait for a remote site, and an outage there must not fail
  the review.

## Filtering

The Reviews page has a **decision filter** — *All decisions*, *No decision*, or any one
status — which combines with the project, type and published/draft filters. It is the fastest
way to answer "what is still waiting on me" (*No decision*) or "what did we retake this
week".

## Use cases

### The normal circuit

1. The artist uploads a version and publishes it.
2. The supervisor reviews the media, puts **Retake** from the clipboard button, and writes
   what has to change in the decision comment. The artist is notified.
3. The artist uploads **v02** and publishes.
4. The supervisor puts **Approved**. The badge turns green everywhere the version appears,
   the watchers hear about it, and the approval flag propagates to whatever is plugged in
   downstream.

Nothing in that circuit modifies the earlier version: the retake decision, its comment and
its date stay on v01 forever. Three months later you can still see why v01 came back.

### Clearing the queue on Monday morning

Open the Reviews page, filter on *No decision*, and go down the list. Every media you open
already has the clipboard button in its header, so deciding never means going back to a task
page. What is left in the filter at the end of the pass is exactly what you did not get to.

### A studio that does not say "CBB"

Some studios work with *Pending / Approved / Retake*, others with a five-step ladder, others
in their own language. Rebuild the list in *Admin → Review contexts → Statuses*, put the
*approval* flag on whatever you call "final" and the *retake* flag on whatever you call
"back to the artist", and order them the way the pipeline reads. Existing decisions keep
pointing at their status, which is why used statuses can be renamed but not deleted.

### A show run from ShotGrid

Link the project, map the ReView statuses onto the site's version statuses, and the picker
narrows to that mapping. From then on the decision travels: the supervisor decides in
ReView, the queue pushes it to ShotGrid, and production reads the show's usual vocabulary.
See [ShotGrid integration](../admin-guide/shotgrid-integration.md).

## Troubleshooting

**The status list is shorter than what the admin configured.** The project is linked to
ShotGrid, and only the mapped statuses are offered. Add the mapping on the site, or on the
project's ShotGrid settings.

**"This status is used by N decision(s) — it cannot be deleted".** History wins. Rename or
reorder it; if you want it out of circulation, move it to the end of the list.

**I can open the decision dialog but not the chips.** Deciding is restricted to `SUPERVISOR`
and `ADMIN`. Everyone else gets the read-only history — which is the point: the record is
public, the decision is not.

**The badge did not change on the task page.** The badge shows the *latest* decision on the
version. Reload the page if you decided from the review header in another tab.

**The author was not notified.** They are not notified when they decide themselves, and
watchers exclude both the actor and the author to avoid sending the same person two
notifications for one event.

## Related pages

- [The review workspace](review-workspace.md)
- [Annotations & comments](annotations-and-comments.md)
- [Projects & pipeline](projects-and-pipeline.md)
- [Kanban & tasks](kanban-and-tasks.md)
- [ShotGrid integration (admin)](../admin-guide/shotgrid-integration.md)
- [Admin overview](../admin-guide/overview.md)
