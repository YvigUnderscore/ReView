# Video review

> Updated: 2026-07-18

Open any video media from a project, task or the Reviews page to enter the video
review. The player is frame-accurate and streams adaptive HLS.

## Transport & timeline

- Play/pause, **frame-by-frame stepping** (arrow keys) and scrubbing on the
  timeline. Scrubbing is smooth: seeks are coalesced so fast drags never leave the
  player in an inconsistent state.
- The current **frame number** is displayed and used to anchor annotations and
  comments; frame ranges come from the pipeline settings (shot frame ranges,
  framerate).
- **Quality selector**: adaptive by default; you can pin a rendition (e.g. 1080p) —
  the player locks the manifest to that rendition, with a spinner while switching.

## Comparison

- **A/B compare**: load another version of the same task side by side and switch
  instantly.
- **Wipe**: split-screen slider over two versions for pixel-accurate comparison.

## Frame & guides

The viewer fills the available space; a **letterbox guide** shows the delivery
aspect ratio resolved from the pipeline settings. Annotations are anchored to the
**delivery frame**, so they stay in place whatever the window size.

## Fullscreen

Two fullscreen modes:

- **Unified fullscreen** (`Maximize` button): the whole review block — header,
  viewer, playbar and the comments panel — so you can keep annotating.
- **Immersive video fullscreen** (`Expand` button in the transport bar): the video
  alone fills the screen; the playbar becomes a translucent dark overlay that
  auto-hides (with the cursor) after 1 s of inactivity.

## Annotations & comments

Draw on any frame with the annotation tools; annotations are timestamped and appear
as markers on the timeline. See
[Annotations & comments](annotations-and-comments.md).

## Trim

Before publication, a video can be trimmed (in/out) from the review; the worker
re-cuts the delivery. Trim is locked once the version is published.

## Related pages

- [Review image](review-image.md)
- [Upload & publishing](upload-and-publishing.md)
- [Transcoding (admin)](../admin-guide/transcoding.md)
