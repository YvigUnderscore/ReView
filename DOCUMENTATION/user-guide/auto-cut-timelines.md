# Auto-updating cut timelines

> Updated: 2026-08-21

Every sequence — and the project as a whole — carries a **cut** that keeps itself up to
date. Its content is never stored: it is recomputed from the current state of production
every time it is read, so publishing a new shot version is enough to update it. Nothing
to regenerate, no list to maintain by hand.

The whole-film cut sits at the top of the project's **Sequences** tab; a sequence's own
cut sits at the top of its page. Both are the same card.

## What the cut contains

One clip per shot, in production order: sequence order, then sequence code, then shot
order, then shot code (numerically aware, so `SH9` sorts before `SH10`).

For each shot, the cut takes **the version of the furthest stage reached in the pipe** —
not simply the most recent one. An animation fix published after compositing does not
send the shot backwards in the edit. Among the versions at that stage, the most recent
wins.

Only **published versions carrying at least one published, `READY` media** are candidates,
and a video media is preferred over anything else in the version.

The stage order is the **ordered department list** of the project (see
[Pipeline settings](../admin-guide/pipeline-settings.md)). Reordering that list changes
what "latest version" means everywhere: on assets, on shots, and in every cut.

## Gaps are shown, not hidden

A shot with no published media still takes its place, for its own duration, as a
**placeholder card**. A cut that skipped its gaps would lie about its running time and
hide exactly what a supervisor is looking for.

Placeholder duration comes from the shot's declared frame range —
`(end − start + 1) / fps` — and falls back to **four seconds** when the range is missing
or unusable. The card header counts them: *n gaps*, or *Complete*.

Clip duration is the media's real duration. When it differs from the declared frame range
by more than half a second, the clip is **flagged** with an amber warning triangle rather
than silently trimmed.

The framerate is the sequence's override when it has one, otherwise the project's
setting.

## Watching a cut

**Play** opens the cut on its own page (`/timelines/:id/play`). That page is the video
review page — same header, tool rail, options bar, inspector dock, transport and comments
space — with one difference: the timeline is the **whole film**, on a single scale from
zero to the end. Nothing else about the screen changes, so it reads without relearning.

Playback has **no cut in it**. Two video players take turns: while one plays, the next
clip is already loading in the other, and the changeover is a swap of visibility. Shot
and sequence changes are read on the timeline and in the label at the top
(`SQ020 · SH010 · v0002`), never as a black frame — nothing navigates, so nothing
interrupts the screening.

- Placeholders **hold their slot** for their own duration, timed independently of the
  video element: the cut runs for as long as the timeline says it does, gaps included.
- Playback is bounded by the **cut's** duration, not the file's: a media longer than the
  slot it was given is trimmed here rather than pushing the rest of the film out of sync.
- Frame stepping, timecode and frame number are those of the **film**, at the project
  framerate. Stepping across a cut is a step like any other.
- Each shot is served exactly as the review serves it — adaptive HLS through the
  authenticated proxy when renditions exist, the web MP4 otherwise. A shot that plays in
  its own review plays here too.
- The **Shots** drawer, under the transport, shows the clips as thumbnails; clicking one
  jumps there.
- The transport is **mouse-driven**: click the image to play or pause, use the buttons to
  step. This page registers no playback keyboard shortcuts of its own — no spacebar
  play/pause, no next-shot key.
- The cut card on the sequence or project page shows the same timeline without the
  player: it is a map of the film, and clicking a clip enters the page there. The page can
  also be opened at a given position — the card passes the time it was clicked at.

## Reviewing the cut itself

Feedback written here belongs to the **cut**, at its position in the film: that is what
you were watching. Comments appear as diamonds on the same single timeline, ordered by
their position in the film, and drawing on the image works as in any review — the
annotation is attached to the comment and comes back when it is reopened.

Each comment is nevertheless stored with **two coordinates**: its position in the film,
and the frame **inside the clip's media**. That second one is what makes the next gesture
possible.

**Right-click a comment → *Send to the shot review*** and it also appears in that shot's
own review, on that exact image. Nothing is moved and nothing is copied: a single flag is
raised on the comment, so the note stays on the cut and gains a second home. A copy would
diverge the moment either side was edited.

Until it is shared, a cut comment stays with the cut. A screening produces many editing
notes, and pouring them all into the artist's review would drown the feedback actually
addressed to them. Sharing is open to **the comment's author or a supervisor/admin**, and
the first share notifies the shot's watchers.

A placeholder cannot be commented on — there is no image to attach the note to, and the
page says so.

## Targeting a stage

The department selector on the cut card switches between:

- **Furthest stage** (the default): each shot shows how far it has got;
- **a specific department** (Layout, Animation, Lighting…): the chosen stage becomes a
  **ceiling**. Each shot shows that stage, falling back **upstream** when it has not
  reached it yet — asking for "Lighting" on a shot that has none shows its animation
  rather than a gap; asking for "Layout" on a shot already in compositing shows the
  layout, not the comp.

Two consequences worth knowing: the selector never shows work *later* than the target,
and versions whose task carries **no department** drop out of the cut entirely as soon as
a department is selected.

Only supervisors and admins can change the selector; the choice is stored on the cut, so
everyone sees the same film.

## Freezing a revision

**Freeze** stores a dated, numbered revision of what is on screen. Shot codes, sequence
codes, version names, departments and durations are **copied into** the revision, so it
stays readable even if a shot is later renamed, omitted or trashed.

Opening a revision also shows what changed since the **immediately preceding** one: shots
added, shots removed, and shots whose version changed. The comparison is made on **shot
codes**, not database ids, because a shot can be deleted and recreated. Reordering and
duration changes are not reported.

Freezing, renaming and targeting a stage are reserved to supervisors and admins. Any
project member can read and play a cut.

## Exporting a single file

**Export** encodes the whole cut into one MP4 — H.264 video at the project's resolution
and the cut's framerate, AAC stereo audio at 48 kHz — placeholders included, so the
running time matches the cut on screen. A placeholder becomes a black silent clip
carrying the shot code, so a gap is identifiable in the exported file too.

The job runs in the background, one cut at a time so it does not starve routine
transcodes; the button turns into a download link when the file is ready. Each cut has a
single master: **re-running the export replaces the previous file**. Asking for an export
while one is already running does nothing rather than queuing a second.

Segments are encoded from the transcoded proxy when there is one, to avoid re-encoding
EXR or ProRes sources, then concatenated without a second pass.

Playback inside ReView never needs this file — it exists to send the cut outside the
application. Export is reserved to supervisors and admins, and the button is disabled
when no clip has a media.

## Omitting a shot

A shot cut from the edit carries an **omitted** flag. Cuts skip it entirely, while its
tasks, versions, media and comments are preserved — deleting the shot would lose all of
that, and it is not a soft delete. The sequence's shot grid marks it with an eye-off
badge so it is visible as a deliberate choice rather than an absence.

The flag is written through `PATCH /api/shots/:id` (`omitted: true`); there is no toggle
in the shot settings panel yet. It affects the cuts only — the shot still counts in the
Production tab's matrix, workload and attention lists.

## Use cases

### Screening the film at the end of the week

1. Open the project → **Sequences** tab. The whole-film cut is the first card.
2. Read the badge: *4 gaps* tells you four shots have nothing published. That is the
   agenda before it is a screening.
3. **Play**. The film runs end to end, gaps included, at their real duration — so the
   running time you read is the running time you will deliver.
4. Take notes as you watch: they land on the cut, at the position in the film, with the
   drawing if you made one.
5. Afterwards, right-click the two or three notes that are genuinely for an artist →
   **Send to the shot review**. The rest stay editorial notes on the cut.

### Comparing two states of the edit

1. Before the screening, **Freeze** the cut. It becomes revision *n*.
2. A week later, freeze again. Open the new revision: it lists the shots added, the shots
   removed, and the shots whose version changed since revision *n*.
3. That list is your changelog for the production meeting — and it stays readable even if
   a shot was renamed in between, because the revision stored the codes rather than
   pointers.

### Watching the animation pass across a whole sequence

The lighting is halfway done and you want to check the animation, not the comp.

Set the cut card's department selector to **Animation**. Shots already in comp fall back
to their animation version; shots that never had one fall back further upstream. What you
watch is a coherent animation pass, not a patchwork of stages.

Remember to set the selector back to **Furthest stage** afterwards — the choice is stored
and everyone sees it.

### Sending the cut to the editor

1. Set the stage selector to **Furthest stage**.
2. **Export**. The job encodes in the background; keep working.
3. When the button becomes a download link, the MP4 has the project's resolution, the
   project's framerate, stereo audio, and the exact running time of the cut on screen —
   placeholders as black cards with their shot code, so the editor can see what is
   missing rather than guessing.
4. Re-export after the next round of publishes: the master is replaced, the link stays
   the same.

### A shot that was dropped from the edit

Editorial cut SH120. Do **not** delete it: set its `omitted` flag. It disappears from
every cut and stops distorting the running time, but its versions, notes and history stay
where they are — and the sequence grid shows an eye-off badge so nobody re-creates it by
mistake next month.

## Related pages

- [Projects & pipeline](projects-and-pipeline.md) — sequences, shots, publication
- [Review video](review-video.md) — the player the cut page reuses
- [Annotations & comments](annotations-and-comments.md)
- [Pipeline settings (admin)](../admin-guide/pipeline-settings.md) — the department order
  that decides "furthest stage"
