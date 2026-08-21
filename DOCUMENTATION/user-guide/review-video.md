# Video review

> Updated: 2026-08-21

![Video review: transport with timecode and frame counter, tool rail on the left, inspector dock and comment thread on the right.](../assets/user-guide/review-video.png)

> All four media types share the same workspace — mode switch, tool rail, options bar,
> inspector dock, bottom row. See **[The review workspace](review-workspace.md)** for the
> layout, the modes and the keyboard map; this page covers what is specific to video.

Open any video media from a project, a task or the Reviews page to enter the video review.
The player is frame-accurate, custom-built (there is no native browser control bar) and
streams adaptive HLS when renditions exist.

## Transport & timeline

- **Play / pause** with `Space`, with the button in the transport, or by clicking the
  picture itself.
- **Frame stepping**: `←` / `→` move one frame, `Shift+←` / `Shift+→` move ten.
- **J / K / L**: reverse shuttle, pause, forward play. Pressing `J` or `L` repeatedly
  stacks speed (×2 / ×4 / ×8, capped at ×8); the current speed shows as a chip on the
  viewer (`◀ ×2`, `▶ ×4`) whenever playback is not normal ×1. Backward playback does not
  exist in HTML5 video — it is simulated frame by frame, so it is smoother on a proxy than
  on a heavy master.
- **`M`** pauses and opens the comment composer at the current frame.
- Scrubbing on the timeline is smooth: seeks are coalesced, so a fast drag never leaves the
  player in an inconsistent state.
- The transport shows the **current frame** (offset by the shot's start frame) over the
  last frame, plus a timecode. Annotations and comments are anchored to that frame number.
- The **fps** field next to it is read-only when the framerate was detected from the file,
  and editable when it was not — set it before commenting, since every frame number depends
  on it.
- **Hover thumbnails**: moving the cursor along the timeline shows the filmstrip thumbnail
  for that instant, with its timecode underneath. The filmstrip is generated at transcode
  time; a media processed before that feature, or with the sprite disabled, simply has no
  hover preview.
- **Loop playback** (the circular arrow in the transport) repeats the whole clip. It is
  independent of the I/O loop below.

## Loop (I/O points)

- `I` and `O` set the loop in and out points at the current frame; `Shift+I` or `Shift+O`
  clears both.
- The **I/O loop chip** in the transport suspends the loop **without removing the points**;
  the small `×` next to it clears them. Setting a new point re-enables the loop.
- Looping only applies **during playback** — manual navigation (pause, stepping, scrubbing)
  can freely go past the out point.
- When a loop is active while you send a comment, the comment carries the **in→out range**:
  its drawings stay visible for the whole range during playback, and the range shows as a
  coloured segment (the author's colour) with handles on the timeline. Click a segment to
  select the comment.

## Timeline markers

Named, coloured markers shared with the whole team and persisted on the media:

- **Right-click the timeline** → *Add a marker here…*, then type a name and pick one of the
  six colours. Available to `ARTIST`, `SUPERVISOR` and `ADMIN`.
- Hover a marker tick to see its name and author; click it to seek there.
- Right-click a tick → rename / recolour / delete. Allowed to the author, or to any
  `SUPERVISOR` / `ADMIN`.
- Markers appear as **clickable separators in the comments panel**, splitting the thread
  into sections by timeline position.
- Changes propagate live: a marker added by someone else appears without reloading.
- With **scene detection** enabled in the studio transcoding settings, markers are placed
  automatically at the detected cuts.

## Playback quality

The quality selector sits at the right of the transport.

- There is **no automatic bitrate switching**. Playback starts locked on the highest
  available rendition, so what the selector shows is always what is being served.
- Changing quality **while playing** takes effect at the next fragment — no buffer hole, no
  sound over a frozen frame. Changing it **while paused** refreshes the displayed frame.
- While a video is still transcoding you can already play the first ready rendition; higher
  qualities appear in the selector on their own as the worker finishes them, keeping your
  position and playback state.
- A media with no HLS renditions shows a single **Original** entry and plays the MP4 proxy.

## Comparison

Use the **Compare…** selector in the header — a checkbox list of the other versions of the
same task or asset.

- **One version checked — A/B**: the second version plays muted and synchronised with the
  master. Three sub-modes, from the *Wipe bar* tool (`W`) options or the *Comparison*
  panel: **side by side**, **Wipe** and **Diff**.
- The **wipe bar** carries two handles: the round grip at its centre slides it across the
  picture, and the small handle further along the bar rotates it — the current angle is
  displayed next to it. Double-click the centre grip to snap back to vertical and centred.
- **Two or three versions checked — 2×2 grid**: up to four versions on screen (three B
  panes maximum), all slaved to the master transport. Each pane has its own close button;
  wipe and diff are only available in simple A/B.
- **Diff mode** computes |A − B| in the browser on a canvas. Click the `×n` chip to cycle
  the amplification (×1 → ×2 → ×4 → ×8 → ×16 → back) — the raw difference is often
  invisible — and the flame icon for a false-colour heatmap that runs from dark for no
  difference through blue and green to red for the largest.
- A version that carries no video media raises an explicit error instead of opening an
  empty pane.
- In a **live session**, the driver's comparison (selected version, side / wipe / diff mode
  and the wipe bar position) is replicated to every viewer.

## Frame & guides

The picture is fitted to the available space at its own aspect ratio; the annotation
overlay shares exactly the same box, so a stroke stays on the pixel it was drawn on
whatever the window size or the fullscreen mode. (The delivery-aspect letterbox guide is a
3D and splat feature — a video is shown as it was encoded.)

**Composition guides** — rule of thirds, centre cross, action safe (90 %) and title safe
(80 %) — are toggled from the viewer's right-click menu or from the *Guides* panel of the
dock. The preference is local to your browser and applies to every video you open.

## Right-click in the viewer

The native browser menu is replaced by a review menu:

- *Annotate* / *Finish the annotation*, and *Hide the annotation* when one is displayed.
- *Play / pause*, *Previous frame*, *Next frame*, *Composition guides*.
- *Copy the frame*, *Download the frame*, and *Download the annotated frame* when
  annotations are visible.
- *Export the contact sheet* — a PNG grid built from the timeline filmstrip with a timecode
  under each tile. Only offered when the media has a filmstrip.
- *Copy the link to this frame* — a URL carrying `?frame=N`; opening it seeks straight
  there.
- *Current frame → thumbnail* for anyone who can manage the media.
- *Add to playlist…* for every role except `CLIENT`.

## Fullscreen & viewing modes

- **Unified fullscreen** (the *Maximize* button in the transport) takes the whole review
  block — header, viewer, playbar and comments — into browser fullscreen, so you can keep
  annotating.
- **Video-only fullscreen** (the *Expand* button in the transport): the picture alone fills
  the screen and the playbar becomes a translucent overlay that fades out, cursor included,
  after one second of inactivity. Move the mouse to bring it back.
- **Theatre mode** (the screen icon in the review header) hides the app shell, the review
  header and the comments panel and shows the media full-frame *inside the window*. `Esc`
  leaves it. This is not browser fullscreen, and it works when fullscreen is blocked.
- **Detachable player** (the picture-in-picture icon in the review header, video only) pops
  the video into the browser's own floating window so you can keep watching while working
  elsewhere.
- **Animated thumbnails**: hovering a video card in the Reviews list cycles through its
  filmstrip tiles as a live preview.

## Trim

A video can be trimmed from the review before it is published.

1. Switch to the **Trim** mode (key `3`).
2. Arm *In point* (`I`) or *Out point* (`O`) and press it at the current frame — or use the
   *Marker here* / *Out here* buttons in the options bar. The options bar summarises the
   bounds and the number of frames kept.
3. Save from the commit group at the right of the options bar.

The worker then produces a **trimmed proxy** and the original file is never modified; the
proxy is served to everyone on the next load. Until it is ready, the out-of-trim regions
are simply shaded on the timeline. The out point must come after the in point, and clearing
the trim returns the full video.

Trim is only offered to someone who can manage the media, and only before publication —
see the troubleshooting section below.

## Annotations & comments

Draw on any frame with the annotation tools; annotations are anchored to the frame and
appear as author avatars on the timeline. With an I/O loop active, the annotation covers
the whole range. See [Annotations & comments](annotations-and-comments.md).

## Use cases

### The end-of-day dailies pass

You have twenty shots to go through before the client call. Open the first one from the
Reviews page and play with `L`; `L` again doubles the speed for a stretch you already know.
The moment something is off, `K` stops on the spot, `←` walks back to the offending frame,
and `M` pauses and drops you straight into the composer with that frame attached. Circle
the area, send, move on with the next / previous media arrows in the header. Every note you
left is a timeline avatar the artist can click tomorrow morning.

### A flicker you cannot pin down

Set `I` two frames before and `O` two frames after the suspect area, then play: the clip
loops on those four frames until you can name what moves. Comment while the loop is
active — the note carries the range, so the artist opens it and gets exactly the same loop
rather than a single frame with "around here it flickers".

### Before / after on a colour fix

Check the previous version in *Compare…*, arm the wipe bar with `W`, and drag the split
across the picture by its centre grip; the second handle turns it horizontal if the fix runs
along the horizon. When
the difference is too subtle to see, switch to *Diff* and click the `×n` chip up to ×8 —
what was invisible side by side becomes an obvious patch. The heatmap makes it printable
for a note.

### A remote client approval

Put the version in a playlist, share it, and drive a live session. Your comparison choice,
your wipe position and your playhead are replicated to everyone watching, so "the shot on
the left, at 1012" needs no explanation. The client, on a `CLIENT` account, sees only the
Watch mode: no trim, no annotation tools, nothing that could alter the media.

### Cutting the slate off a playblast

The version arrives with ten frames of slate and eight of black tail. In **Trim** mode, put
the in point after the slate and the out point before the tail, save, and the whole team
gets the clean proxy on their next load. The uploaded file is untouched, so nothing is lost
if the bounds were wrong — set them again and save.

## Troubleshooting

**"Video not ready yet (still processing)" when saving a trim.** The media is still being
transcoded. Wait for the status to become ready, then set the bounds again.

**Trim, reprocess and thumbnail are refused with a 403.** The version is published, and a
published media is frozen for good. Publish a new version instead — the trim, like every
other edit, is part of what the publish lock protects.

**The Trim mode exists but its options bar is empty.** Trimming is limited to users who can
manage the media (its uploader, a supervisor or an admin) and to unpublished media.

**No hover thumbnail, and no contact sheet in the right-click menu.** Both come from the
same timeline filmstrip, generated during transcoding. If the media predates the feature,
reprocess it.

**The quality selector is stuck on "Original".** The media has no HLS renditions — it was
transcoded to a single MP4 proxy, or the quality ladder is disabled in the studio
transcoding settings.

**Sound plays over a frozen picture after a seek.** Playback waits for a decodable frame
before starting, and quality changes during playback are deferred to the next fragment
precisely to avoid this. If it still happens, the network is starving the stream: pin a
lower rendition in the quality selector.

**The comment I selected disappeared from the picture.** Moving the playhead by hand
un-selects the comment and hides its annotation, because the drawing is only aligned with
its own frame. Click the comment card again to jump back.

## Related pages

- [The review workspace](review-workspace.md)
- [Image review](review-image.md)
- [Annotations & comments](annotations-and-comments.md)
- [Playlists & live review](playlists-and-live-review.md)
- [Upload & publishing](upload-and-publishing.md)
- [Personalization & everyday UX](personalization.md)
- [Transcoding (admin)](../admin-guide/transcoding.md)
