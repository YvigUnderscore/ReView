# Exporting review notes

> Updated: 2026-08-22

Review notes do not have to stay inside ReView. Any thread — a single media, a version, a
shot, a playlist or an auto-cut timeline — can leave the application as a spreadsheet, as an
editorial file the cutting room can read, or as a printable sheet where each note sits on the
frame it was written on.

## Where to start an export

Open a review and go to the **Export** panel of the inspector dock. Under *Review notes* you
get two entries:

| Entry | File | Use it for |
|-------|------|------------|
| Spreadsheet (CSV) | `notes-media-<id>.csv` | Production tracking, retake lists, pasting into a supervision sheet |
| Printable sheet | `notes-media-<id>.html` | Paper read-through, a PDF for a client, an archive of a round of notes |

Both act on the media currently open. The editorial formats (EDL, OTIO) describe a *sequence
of clips*, so they are produced from a playlist or from a timeline rather than from a single
media.

## What each format contains

### Spreadsheet (CSV)

One row per note — replies included, linked to their parent by `reply_to`. Columns, in order:

`note_id`, `reply_to`, `sequence`, `shot`, `task`, `version`, `media`, `frame`, `timecode`,
`range_frames`, `author`, `created_at`, `state`, `resolved`, `resolved_by`, `assignee`,
`decision`, `client_visible`, `annotated`, `content`.

- `frame` is the frame **as the review displays it**, on the project's start-frame base;
  `timecode` is the media's own non-drop timecode (`00:00:00:00` = first frame).
- `range_frames` is the length of the commented range, for notes written over an in→out span.
- `decision` is the current review decision of the version carrying the note.
- The file is UTF-8, comma-separated, with the same conventions as the pipeline CSV
  (see [projects-and-pipeline.md](projects-and-pipeline.md)). Any cell that would look like a
  spreadsheet formula is neutralised, so opening the file cannot execute anything.

### EDL (CMX3600)

One event per clip, laid end to end, with every note as a `* LOC:` marker at the record
timecode where it was written. The reel is the auxiliary `AX` and the real media name is
carried by `* FROM CLIP NAME:`, because the CMX3600 reel column only holds eight characters.
Marker colours follow the note state: red (open), yellow (in progress), cyan (question), blue
(won't fix), green (resolved).

Everything starts at `00:00:00:00`: ReView does not store a source timecode yet, and an EDL
that invented one would be worse than an honest one.

### OpenTimelineIO

The same timeline as a `.otio` JSON document: one video track, one clip per media, notes as
`Marker.2` entries carrying the note id, state and author in their metadata. The schema
versions used (`Timeline.1`, `Stack.1`, `Track.1`, `Clip.1`, `ExternalReference.1`) are the
ones every OTIO release since 0.14 can read.

### Printable sheet

A self-contained HTML document: one block per note with the commented frame, the annotation
drawn over it, and the text with its author, timecode, state and decision. Print it
(`Ctrl+P` / `⌘+P`) and choose *Save as PDF* to get the PDF version — the layout is already
set up for it, and page breaks never cut a note in half.

The frame shown is the nearest thumbnail of the timeline sprite the worker already computes
for the player's hover preview, so a sheet is produced in one request instead of one video
seek per note. For images, 3D and splats the media thumbnail is used instead.

## Access and limits

- The export follows the usual project access rules: you must be a member of the project the
  scope belongs to (`ADMIN` and `SUPERVISOR` have global access).
- A `CLIENT` account only exports the notes marked visible to clients — an exported file
  travels, and internal review does not have to travel with it.
- Notes written on a timeline stay on that timeline until someone shares them back to the
  shot, exactly as in the review panel.
- A spreadsheet, EDL or OTIO export stops at 5000 notes; a printable sheet stops at 200
  (each note carries an image). When the cap bites, the interface says so and the response
  carries an `X-Notes-Truncated` header.

## Related

- [Annotations & comments](annotations-and-comments.md) — what a note carries.
- [Playlists & live review](playlists-and-live-review.md) — building the list an EDL exports.
- [Auto-cut timelines](auto-cut-timelines.md) — the montage an OTIO export describes.
