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

## Playing a cut

*Lire* opens the first playable clip in the review player with `?timeline=<id>`.
From there:

- playback **chains automatically**: when a clip ends, the next one starts;
- placeholders are skipped during playback (they remain counted in the cut);
- the header shows the cut name and the position (`3/12`), with previous/next
  buttons;
- comments, annotations and review decisions work as usual — they belong to the
  shot's version, not to the cut.

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
