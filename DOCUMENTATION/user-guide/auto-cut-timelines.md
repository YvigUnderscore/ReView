# Auto-updating cut timelines

> Updated: 2026-08-09

Every sequence — and the project as a whole — carries a **cut** that keeps itself
up to date. Its content is never stored: it is recomputed from the current state
of production every time it is read, so publishing a new shot version is enough
to update it. Nothing to regenerate, no list to maintain by hand.

## What the cut contains

One clip per shot, in production order (sequence order, then shot order, then
shot code). For each shot, the cut takes **the version of the furthest stage
reached in the pipe** — not simply the most recent one. An animation fix
published after compositing does not send the shot backwards in the pipe.

The stage order is the **ordered department list** of the project (see
[Pipeline settings](../admin-guide/pipeline-settings.md)). Reordering that list
changes what "latest version" means everywhere: on assets, on shots, and in every
cut.

## Gaps are shown, not hidden

A shot with no published media still takes its place, for its own duration, as a
**placeholder card**. A cut that skipped its gaps would lie about its running
time and hide exactly what a supervisor is looking for. Placeholder duration
comes from the shot's declared frame range, or falls back to four seconds.

Clip duration is the media's real duration. When it differs from the shot's
declared frame range, the clip is **flagged** (amber warning triangle) rather
than silently trimmed.

## Watching a cut

*Play* opens the cut on **its own page** (`/timelines/<id>/play`). That page is
the video review page — same header, tool rail, options bar, inspector dock,
transport and comments space — with one difference: the timeline is the **whole
film**, on a single scale from zero to the end. Nothing else about the screen
changes, so it reads without relearning.

Playback has **no cut in it**. Two video players take turns: while one plays, the
next clip is already loading in the other, and the changeover is a swap of
visibility. Shot changes and sequence changes are read on the timeline and in the
label at the top (`SQ020 · SH010 · v0002`), never as a black frame — nothing
navigates, so nothing interrupts the screening.

- Placeholders **hold their slot** for their own duration: the cut runs for as
  long as the timeline says it does, gaps included.
- Playback is bounded by the **cut's** duration, not the file's: a media longer
  than the slot it was given is trimmed here rather than pushing the rest of the
  film out of sync.
- Frame stepping, timecode and frame number are those of the **film**, at the
  project framerate. Stepping across a cut is a step like any other.
- Each shot is served exactly as the review serves it — adaptive HLS through the
  authenticated proxy when renditions exist, the web MP4 otherwise. A shot that
  plays in its own review plays here too.
- The *Shots* drawer, under the transport, shows the clips as thumbnails;
  clicking one jumps there.

## Reviewing the cut itself

Feedback written here belongs to the **cut**, at its position in the film: that
is what you were watching. Comments appear as diamonds on the same single
timeline, and drawing on the image works as in any review — the annotation is
attached to the comment and comes back when it is reopened.

Each comment nevertheless stays anchored to the shot's media and to its exact
frame. **Right-click a comment → *Renvoyer sur la review du shot*** and it
appears in that shot's own review, on that exact image, while remaining on the
cut. Until then it stays with the cut: a screening produces many editing notes,
and pouring them all into the artist's review would drown the feedback actually
addressed to them.

The cut card on the sequence or project page shows the same timeline, without the
player: it is a map of the film, and clicking a clip enters the page there.

## Targeting a stage

The department selector on the cut card switches between:

- **Furthest stage** (default): each shot shows how far it has got;
- **a specific department** (Layout, Animation, Lighting…): each shot shows that
  stage, falling back **upstream** when it has not reached it yet — asking for
  "Lighting" on a shot that has none shows its animation rather than a gap.

## Freezing a revision

*Figer* stores a dated, numbered revision of what is on screen: shot codes,
version names and durations are **copied into** the revision, so it stays
readable even if a shot is later renamed, omitted or trashed. Opening a revision
also shows what changed since the previous one: shots added, shots removed, and
shots whose version changed.

Freezing, renaming and targeting a stage are reserved to supervisors and admins.
Any project member can read and play a cut.

## Exporting a single file

*Exporter* encodes the whole cut into one MP4 (project resolution, project
framerate, stereo audio), placeholders included, so the running time matches the
cut on screen. The job runs in the background; the button turns into a download
link when the file is ready. Re-running the export replaces the previous file.

Playback inside ReView never needs this file — it exists to send the cut outside
the application.

## Omitting a shot

A shot cut from the edit can be marked **Omis du montage** in its settings. It
disappears from every cut but keeps its tasks, versions, media and comments —
deleting the shot would lose all of that.
