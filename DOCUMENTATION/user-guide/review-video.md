# Video review

> Updated: 2026-08-01

> All four media types share the same workspace — mode switch, tool rail, options bar,
> inspector dock, bottom row. See **[The review workspace](review-workspace.md)** for the
> layout, the modes and the keyboard map; this page covers what is specific to video.

Open any video media from a project, task or the Reviews page to enter the video
review. The player is frame-accurate and streams adaptive HLS.

## Transport & timeline

- Play/pause, **frame-by-frame stepping** (arrow keys) and scrubbing on the
  timeline. Scrubbing is smooth: seeks are coalesced so fast drags never leave the
  player in an inconsistent state.
- **J / K / L**: reverse shuttle, pause, forward play. Pressing `J` or `L`
  repeatedly stacks speed (×2/×4/×8); the current speed is displayed as a chip on
  the viewer (`◀ ×2`, `▶ ×4`) whenever playback is not normal ×1.
- The current **frame number** is displayed and used to anchor annotations and
  comments; frame ranges come from the pipeline settings (shot frame ranges,
  framerate).
- **Hover thumbnails**: moving the cursor along the timeline shows the filmstrip
  thumbnail for that instant (generated at transcode time).
- **Quality selector**: playback starts locked on the best available rendition;
  you can pin any rendition (e.g. 1080p). While a video is still transcoding, you
  can already play the first ready rendition — higher qualities appear in the
  selector automatically as they finish (no reload needed).

## Loop (I/O points)

- `I` / `O` set the loop in/out points at the current time; `Shift+I` / `Shift+O`
  clear them.
- The **Loop I/O chip** in the transport toggles looping **without removing the
  points**; the small `×` next to it clears them. Setting a new point re-enables
  the loop.
- Looping only applies **during playback** — manual navigation (pause, stepping,
  scrubbing) can freely go past the out point.
- When a loop is active while you send a comment, the comment carries the
  **in→out range**: its drawings stay visible during the whole range at playback,
  and the range shows as a colored segment (author color) with handles on the
  timeline. Click a segment to select the comment.

## Timeline markers

Named, colored markers shared with the whole team (persisted per media):

- **Right-click the timeline** → "Add a marker here…" (name + color palette).
- Hover a marker tick to see its name and author; click it to seek.
- Right-click a tick → rename / recolor / delete (author or supervisor+).
- Markers also appear as **clickable separators in the comments panel**, splitting
  the thread into sections by timeline position.
- With **scene detection** enabled (admin, transcoding settings), "Shot n" markers
  are placed automatically at detected cuts.

## Comparison

Use the **Compare…** selector in the header (checkbox list of the other versions):

- **1 version checked — A/B compare**: side-by-side pane synchronized with the
  master player (muted slave), with **Wipe** (rotatable split bar) and **Diff**
  modes.
- **2–3 versions checked — 2×2 grid**: up to four versions on screen, all slaves
  synchronized to the master transport (play/pause/seek/speed, drift-corrected).
  Each pane has its own close button; wipe/diff are only available in simple A/B.
- **Diff mode**: client-side |A − B| difference, GPU-composited. Click the `×n`
  chip to cycle amplification (×1→×16) and the flame icon for a false-color
  heatmap (blue = small difference, red = large).
- In a **live session**, the driver's comparison (selected version, side/wipe/diff
  mode and the wipe bar position) is replicated to all viewers.

## Frame & guides

The viewer fills the available space; a **letterbox guide** shows the delivery
aspect ratio resolved from the pipeline settings. Annotations are anchored to the
**delivery frame**, so they stay in place whatever the window size.

**Composition guides** (right-click → "Composition guides"): rule of thirds,
center cross, action safe (90 %) and title safe (80 %) overlays. The preference is
local to your browser.

## Contact sheet

Right-click the viewer → **"Export contact sheet"** downloads a PNG grid of the
timeline thumbnails with a timecode under each tile — handy for shot breakdowns
and quick reviews outside the tool.

## Fullscreen

Two fullscreen modes:

- **Unified fullscreen** (`Maximize` button): the whole review block — header,
  viewer, playbar and the comments panel — so you can keep annotating.
- **Immersive video fullscreen** (`Expand` button in the transport bar): the video
  alone fills the screen; the playbar becomes a translucent dark overlay that
  auto-hides (with the cursor) after 1 s of inactivity.

## Annotations & comments

Draw on any frame with the annotation tools; annotations are timestamped and appear
as markers on the timeline. With an I/O loop active, the annotation covers the
whole range (see above). See
[Annotations & comments](annotations-and-comments.md).

## Trim

Before publication, a video can be trimmed from the review: switch to the **Trim** mode
(key `4`), arm *In point* (`I`) or *Out point* (`O`) and set the bounds at the current
frame, then save from the commit group at the right of the options bar. The worker re-cuts
the delivery; the original is never modified. Trim is locked once the version is
published.

## Viewing modes

- **Theater mode** — the *Theater* button in the review header hides the sidebar, header and
  comments to show the media full-frame within the window. Press **Esc** to exit. This is
  distinct from browser fullscreen (also available).
- **Detachable player** — the *Picture-in-Picture* button pops the video out into a floating
  window (browser-native) so you can keep watching while working elsewhere.
- **Animated thumbnails** — hovering a video card in the Reviews list scrubs through a live
  preview of the clip.

## Related pages

- [Review image](review-image.md)
- [Upload & publishing](upload-and-publishing.md)
- [Personalization & everyday UX](personalization.md)
- [Transcoding (admin)](../admin-guide/transcoding.md)
