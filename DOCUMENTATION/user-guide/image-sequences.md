# Image sequences

> Updated: 2026-08-22

A shot is not delivered as a file. It is delivered as a thousand: `SH0100_comp_v003.1001.exr`
through `SH0100_comp_v003.1200.exr`. ReView ingests such a delivery as **one media**, not a
thousand, and lets you review it exactly like a video — frame stepping, annotations,
markers, A/B, HLS.

## Delivering a sequence

Drop the frames (or the folder that holds them) onto a task, an asset or a version card,
as you would any other file. ReView reads the names, recognises the numbering, and **asks**
before grouping anything:

- Each detected sequence is listed with its pattern (`SH0100_comp_v003.%04d.exr`), its
  first and last frame, the number of files and the total size.
- Missing numbers between the first and the last frame are counted and shown. A gapped
  delivery is accepted — it is a fact of production — but never silently.
- Untick a sequence to send its frames as ordinary, separate files. **Send file by file**
  does that for the whole drop.
- Anything that is not part of a sequence (a QuickTime reference, a text file) goes to the
  regular upload queue in the same gesture.

Grouping is never applied on its own. Closing the dialog uploads nothing.

### What counts as a sequence

Two or more files sharing the same base name, the same numeric field width and the same
extension, among `.exr`, `.dpx`, `.tif`, `.tiff`, `.tga`, `.png`, `.jpg`, `.jpeg`.

The frame number is the **last** group of digits before the extension: in
`SH0100_comp_v003.1001.exr`, `v003` is a version, `1001` is the frame.

`plan.999.exr` and `plan.1000.exr` are two different patterns (three digits and four), so
they are proposed separately. Pad your numbering and the question does not arise.

A sequence is capped at 10 000 frames. Beyond that the server refuses the batch instead of
truncating it.

### Transfer

Frames are sent four at a time straight to object storage, each with its own retry. The
progress line counts both bytes and files (`342 / 1200 frames`).

The transfer resumes: reopening the same drop on the same version, with the same pattern,
picks up where it stopped — the server lists what actually reached storage and the browser
skips it. Cancelling releases the frames already uploaded rather than leaving them behind.

## What ReView builds

Once every frame has arrived, the worker:

1. assembles a **master** at the shot's frame rate, inherited from
   studio → project → sequence → shot (see [Projects & pipeline](projects-and-pipeline.md));
2. produces the **web proxy**, the **HLS ladder**, the **thumbnail** and the **hover
   sprite**, exactly as for a video.

EXR frames are linear: the sRGB transfer curve is applied on read, otherwise a correct
render would come out nearly black. NTSC rates are written as exact fractions
(`24000/1001`), never as `23.98`.

Gaps are collapsed at assembly: a delivery of 1001, 1002, 1005 plays as three consecutive
frames. The original numbering is what the player displays — the frame counter of a
sequence starting at 1001 reads 1001, not the project's base frame.

## The original delivery is kept

Nothing is deleted. The frames stay in object storage under their own prefix, next to a
`sequence.json` manifest describing the delivery (pattern, bounds, every file name and
size). `GET /api/media/sequence/:id/frames` returns the manifest and a presigned URL per
frame, valid six hours — a hundred-gigabyte archive is not something a web process should
build on the fly.

## Limits

- **Publishing from a DCC** (`POST /api/v1/publish`) does not accept a sequence pattern: it
  refuses `plan.%04d.exr` with `SEQUENCE_NOT_SUPPORTED_HERE` and points at the sequence
  endpoints, rather than opening a media that could never be filled.
- **Antivirus** (opt-in, `CLAMAV_HOST`): every frame is scanned, which is slow on a long
  shot. One infected frame fails the whole media, with the threat named.
- The frame rate is taken from the pipeline settings of the shot. There is no per-upload
  override in the interface yet; the API accepts one (`framerate` on
  `POST /api/media/sequence/init`).
