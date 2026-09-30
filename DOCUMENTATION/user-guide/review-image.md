# Image review

*Pan-and-zoom stills with pixel-anchored notes, pinned references, version comparison, and the studio's own display transform.*

> Updated: 2026-09-20

![Image review: zoom controls under the canvas, reference paste in the top-left corner.](../assets/user-guide/review-image.png)

An image media opens in a pan-and-zoom viewer with annotations anchored to the pixels,
reference pictures pinned inside the picture plane, and A/B comparison against the other
versions of the same task or asset. The mode switch offers two entries — **Watch** (`1`) and
**Compare** (`2`) — and the Annotate mode, which is not listed there: it arms itself from the
comment composer, from the viewer's right-click menu, or from any drawing tool letter. A
`CLIENT` never sees the switch and stays in Watch.

Everything the four media types have in common — mode switch, tool rail, options bar,
inspector dock, bottom row, comments — lives in
**[The review workspace](review-workspace.md)**. This page is what an image does differently.

## What the viewer is actually showing

A browser decodes a handful of image formats and refuses the ones a studio delivers. So the
worker builds a **full-resolution JPEG proxy** for the production formats, and it is that
proxy the viewer, the wipe and the difference read. The delivered file is never rewritten and
never deleted.

| Delivered as | What the viewer receives |
|---|---|
| `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.bmp` | The file itself, untouched |
| `.exr` | A full-resolution JPEG proxy, decoded with the sRGB transfer curve applied — without it a correct render comes out nearly black |
| `.dpx`, `.tif`, `.tiff`, `.tga` | A full-resolution JPEG proxy, decoded as the file is encoded |
| Anything wider or taller than **16 384 px** | The same proxy, scaled down to that limit — JPEG cannot go past 65 535 px a side, and a scan panorama can |

The **info** button of the control cluster folds out the native resolution and the format.
The format is read from the delivered file name, so a plate delivered in EXR reads `EXR` even
though the pixels on screen come from its proxy.

> [!NOTE]
> A DPX in log or Cineon encoding comes out flat, because that proxy applies no curve of its
> own. Putting the curve back is the job of the project's
> [display transform](#colour-management), not of the proxy.

An image sequence is not an image media: a thousand EXR frames become a single media of kind
`VIDEO` and are reviewed in the video workspace. See [Image sequences](image-sequences.md).

## Moving around the picture

- **Zoom** with the wheel, centred on the cursor, one notch at a time (about 1.15× per
  notch), between **0.1×** and **20×** of the fitted size.
- **The percentage is measured against the fit**, not against the native resolution: `100 %`
  is the picture contained in the viewport, which is where a review opens. Press `1:1` on a
  6K plate displayed at a third of its size and the readout jumps to about `300 %`.
- **Pan by dragging**: the left button pans whenever you are not annotating; the middle and
  right buttons always pan, so the picture moves without dropping the armed tool.
- The **control cluster** at the bottom right of the picture carries, in order: zoom out, the
  current percentage, zoom in, **`1:1`** (one image pixel per screen pixel), **fit**,
  **fullscreen**, **info**. There is no double-click shortcut for fit.
- The background is a light grid anchored to the picture — it follows the pan and scales with
  the zoom, which is how you tell a transparent area from a white one and how far you have
  zoomed without reading the number.
- **Fullscreen** (the cluster button) expands the whole review block: header, viewer and
  comments stay, so you keep annotating. **Theatre mode** (the screen icon in the review
  header) hides the application shell and the comments panel; `Esc` leaves it.
- `Tab` folds the inspector dock away and brings it back, `Esc` disarms the current tool.

> [!TIP]
> `F` and `H` do nothing here. Fit and 1:1 live in the control cluster on flat media; the
> rail's view actions and their shortcuts only exist on 3D and Gaussian splat media.

## Annotating a still

Arm the annotation from the composer's pencil, from the right-click menu, or simply by
pressing a tool letter — a drawing letter switches the workspace into Annotate on its own.

| Tool | Key | What it does |
|---|---|---|
| Navigate | `V` | Rest state: drag to move the picture, wheel to zoom |
| Freehand | `D` | Freehand stroke |
| Rectangle | `R` | Box in an area |
| Ellipse | `E` | Circle a detail |
| Arrow | `A` | Point at an element |
| Polygon | `P` | One click per vertex, double-click to close |
| Text | `T` | Drop a label |
| Move a shape | `S` | Pick up a shape of the stroke in progress |
| Eraser | `X` | Click or drag to erase |

The options bar carries the ink (five swatches plus a free colour picker), the **thickness**
(1 to 24 px), the **opacity** (10 to 100 %), undo, redo, clear all, and a count of the shapes
already attached to the comment being written.

Annotations are anchored to the **image pixels**: they share the picture's zoom and pan
transform, so a stroke stays on the detail it was drawn on however far you zoom, and it
survives a window resize or a fullscreen switch. You may draw up to **half an image width
beyond each edge**, which is what makes an arrow pointing in from outside possible. There is
no delivery-aspect letterbox guide on an image — that is a 3D and splat feature — but the four
**composition guides** of the viewer's right-click menu do draw here, as they do on a video.

> [!IMPORTANT]
> A stroke belongs to the comment you are writing. It is sent with it, and from then on it is
> only drawn when that comment is selected. Strokes already sent can no longer be edited. See
> [Annotations & comments](annotations-and-comments.md).

## Reference images

An image review can carry reference pictures pinned **inside** the picture plane — they zoom
and pan with it, so "this corner should look like that" holds at any zoom level.

![The same paste takes two routes: outside a text field it becomes a staged reference, movable until the comment is sent and then frozen with it; with the caret in the composer it becomes an ordinary attachment.](../assets/user-guide/image-reference-lifecycle.svg)

- **Paste with `Ctrl+V`** anywhere outside a text field, or use the *Reference (Ctrl+V)*
  button at the top left of the viewer. Up to **twelve** per comment.
- A pasted reference is about three tenths of an image wide and lands **beside** the picture,
  in the letterbox band the viewer leaves around it — off the right edge when there is room
  there, off the left edge otherwise, each new one a little lower than the last. So it never
  hides the frame you are looking at.
- When the picture fills the whole viewer and leaves no band, the reference falls back to its
  **top-left corner**, where you can move it straight away.
- While the comment is still being written, a reference is outlined in the accent colour:
  **drag it by its body**, **resize it by the handle** at its bottom-right corner, or drop it
  with the bin icon. It may be dragged out of the frame, anywhere in the visible band — never
  so far that it cannot be reached again.
- **Sending the comment freezes them.** Their position is fixed server-side, and from then on
  they are shown only when that comment is selected. Historical references that carry no
  comment stay visible all the time.
- A position saved beside the picture is read against **each reader's** own band: a reference
  that would fall outside the viewer — a narrower window, or a position saved by an older
  version of the application — is brought back against the edge of the picture rather than
  left off screen.
- Anyone who can manage the media can delete a persisted reference with its bin icon.

Pasting with the caret **inside** the comment composer does something else: the image becomes
an ordinary attachment on the comment, shown as a thumbnail in the thread. Eight attachments
maximum, and a clipboard format the server does not accept — BMP, AVIF, an empty type — is
re-encoded to PNG before it is sent.

> [!NOTE]
> The two gestures are distinct on purpose: the ceiling, the ownership and the visibility rule
> all differ. If a paste did not land where you expected, look at where the caret was.

## Comparing two versions

The **Compare…** selector in the review header lists the other versions of the same task or
asset. An image comparison is **exclusive**: ticking a version replaces the current B rather
than building a grid — the 2×2 grid is a video feature. A version that carries no image media
is reported as such instead of opening onto an error.

Three modes, chosen from the **options bar of Compare mode**, which is also where B is picked.
Entering Compare mode already arms the wipe, so the rail carries no comparison tool of its own:

| Mode | What you get |
|---|---|
| **Side by side** | Two panes of the **same size**: each picture is fitted to the same box, so a full-resolution master and a smaller B appear at the same scale. Zoom and pan are replicated both ways, so both stay on the same detail. B carries its name and its switches (*Wipe*, *Difference*, close) floating over the picture rather than in a header above it — a header would make its pane shorter than A’s, and the same picture smaller. |
| **Wipe** | The two pictures superimposed, split by a bar. The round grip at the centre slides it, the smaller handle further along rotates it (the angle is shown next to it), and a double-click on the centre grip snaps it back to vertical and centred. |
| **Difference** | \|A − B\| computed in the browser. The `×n` chip cycles the amplification (`×1`, `×2`, `×4`, `×8`, `×16`) and starts at **×4**, because a raw difference is usually invisible. The flame icon switches to a false-colour heatmap, dark where nothing changed and red where the difference is largest. |

Wipe and difference **replace** the viewer, which is why zoom and pan are suspended in those
two modes: go back to side by side to inspect a detail. The B pane is never annotatable, and
it always shows the raw picture.

> [!TIP]
> A two-pixel edge shift that is invisible side by side shows up as a bright outline in
> **Difference** at `×8`. Push the gain before concluding that nothing moved.

## Colour management

**There is nothing to set here.** A still image is shown through the **display transform of the
project**, applied for everyone who opens it, and the review carries no colour controls of its
own — no display/view picker, no exposure, no gamma, no on/off switch. That was a deliberate
choice when the dock was cut back in Phase 50: a colour decision taken per reviewer, per media,
in a fold of the dock, is a colour decision nobody can quote afterwards. Colour management is the
studio's, set once in *Project → Settings → Colour management* — see
[Colour management](../admin-guide/color-management.md).

![The project's display and view resolve to a baked LUT; the decoded image is rendered through it on the GPU and laid over the original inside the zoom layer. Without a LUT, or without WebGL, the original file is what you see, and the comparison overlays always show raw images.](../assets/user-guide/image-color-pipeline.svg)

What that leaves you is a picture you can trust and two readouts:

| Where | What it says |
|---|---|
| *Info* panel | The project's **Display** and **View**, read-only — the couple the picture went through |
| *Project → Settings → Colour management* | Where the couple is chosen, by someone who can manage the project |

Three things are worth knowing about the transform itself:

- **It needs a baked LUT.** The worker bakes one per display/view couple with its OCIO tooling.
  When there is no LUT for the project's couple — no colour configuration on the project, or an
  instance whose worker ships without OpenColorIO — nothing is applied and you are looking at the
  decoded file. See [Colour management](../admin-guide/color-management.md#baked-luts).
- **It is laid over the original inside the zoom layer**, on the GPU, rather than replacing the
  source. Zoom, pan, annotations, pinned references and the live-session sync are untouched by it,
  and a browser with no WebGL falls back to the original file instead of an empty frame.
- **The comparison overlays — wipe, difference, side by side — show raw images.** Comparing two
  versions means looking at both in the same state.

## Right-click, exports and notes

The viewer's right-click menu, on an image, offers:

- *Annotate* / *Finish the annotation*, and *Hide the annotation* when one is displayed.
- *Copy the image* — into the clipboard, re-encoded as PNG.
- *Download the image*, and *Download the annotated image* when annotations are visible (that
  one is flattened to JPEG, strokes burnt in).
- *Image → thumbnail*, for anyone who can manage the media.
- *Add to playlist…*, for every role except `CLIENT`.
- *Review notes* — the same export submenu as the dock: CSV and printable sheet for this
  media. See [Exporting review notes](exporting-notes.md).

The dock's **Export** panel is deliberately short on a still: *Original file* and the review
notes, under the hint *Only the original file can be exported here*. The two other buttons
you may know — *Displayed view (PNG)* and the contact sheet — belong to video media, where a
frame has to be captured and a timeline sprite exists to compose from.

> [!WARNING]
> Both download paths hand you **the picture the viewer is served**, saved under the
> delivered name. On a plate delivered in EXR, DPX, TIFF or TGA that is the JPEG proxy, not
> the original file — which stays in storage and is reachable through the API
> (`downloadUrl` on `GET /api/media/:id`). Neither download carries the display transform: you
> get the picture as it sits in storage, not as your screen showed it.

## In a live review session

An image review joins a synchronized room like any other media, from the antenna button of
the review header. What the driver does is replayed on every screen:

- **Zoom and pan**, broadcast at the image rate — **4 Hz** by default, configurable per media
  type in *Admin → Settings* between 1 and 30 Hz. The view is normalised, so the room lands
  on the same detail whatever the size of each window.
- **The comparison**: the B version, the mode (side by side, wipe, difference) and the wipe
  bar's position and angle.
- Any local zoom or pan by a pilot or co-pilot **takes the wheel** on the spot — no handover
  ceremony. Sync from anyone who is not the current driver is dropped by the server.

The shared pointer is drawn in the video viewer only; on a still, the room follows the frame
you are on and the zoom you are at. See
[Playlists & live review sessions](playlists-and-live-review.md).

## Use cases

### A matte painting note the artist can act on

The client says the sky is "too heavy". Open the plate, press `E` to arm the ellipse — that
alone switches you into Annotate — circle the cloud bank, then `A` for an arrow pointing at
the horizon line, and write the note. Before sending, paste the reference frame from the edit
with `Ctrl+V` and drag it next to the area concerned. The artist opens the comment and gets
the circle, the arrow and the reference exactly where you left them.

### Checking a texture fix at 1:1

Press `1:1` in the control cluster: one image pixel is now one screen pixel, so what you are
judging is the actual resolution rather than a browser resample. Pan with the middle button
while keeping the eraser armed if you are cleaning up a previous note.

### The plate looks too dark, and you want to be sure

There is no exposure slider to reach for — and that is the answer, not a gap. The picture you see
went through the project's display transform, so it is what the studio agreed a delivery looks
like, and every other reviewer is looking at the same thing. Check the couple in the *Info*
panel, and if the shot is genuinely too dark, that is a comment, not a slider. If the couple
itself is wrong, it is a project setting, and it is wrong for everybody — see
[Colour management](../admin-guide/color-management.md).

### Before / after on a retouch

Tick the previous version in *Compare…* and start in **side by side** — the two panes share
zoom and pan, so you inspect the same 300 % detail in both. When the difference is too fine to
see, switch to **Difference** and push the amplification.

### Approving a still for delivery

A supervisor issues the review decision from the clipboard button in the header, with a
comment. The badge follows the version everywhere it appears, and the version author is
notified. See [Review decisions & approvals](review-approvals.md).

## Troubleshooting

**Zoom and pan do nothing.** You are in wipe or difference comparison, which replace the
viewer. Switch back to side by side, or close the comparison.

**The image is there but it looks nothing like my render.** Check the **Display** and **View**
rows of the *Info* panel: they name the couple the picture went through. A DPX in log encoding, or
an EXR on a project with no colour configuration, is expected to look flat — nothing was applied
because there was nothing baked to apply.

**`Ctrl+V` did not pin my screenshot.** The paste only becomes a pinned reference when the
focus is outside a text field. With the caret in the composer, the same paste attaches the
image to the comment instead. Twelve references per comment is the ceiling, and the toast
says so when you reach it.

**My reference image vanished after I sent the comment.** By design: once sent, a reference
belongs to its comment and is only drawn when that comment is selected.

**I cannot find the composition guides.** They are in the viewer's right-click menu, for both
video and image; the dock's *Guides* panel is gone. The preference is per browser and applies to
every flat media you open.

**The picture is raw and no transform seems to be applied.** Two causes with the same symptom.
Either the project's display/view couple has no baked LUT — an ACES output transform needs a
rendering curve, and the worker of this instance may ship without OpenColorIO tooling, in which
case ReView refuses to guess rather than invent a look; see
[Colour management](../admin-guide/color-management.md#baked-luts). Or this browser gives no
WebGL context (hardware acceleration disabled, a remote desktop, a locked-down profile), and the
original file is shown instead of an empty frame.

**The transform appears a moment after the image.** The transformed picture is rendered and
encoded once the LUT and the decoded image are both in; on a 6K plate that is a fraction of a
second, and the original stays on screen meanwhile.

**I downloaded the image and got a JPEG.** Downloads in the review serve the picture the
viewer is served, which is the proxy for a production format. The delivered file is untouched
in storage; fetch it through the API rather than from the viewer.

**Arming the rail's Zoom tool changes nothing.** On a still, zooming is the wheel, the `+` and
`−` buttons and `1:1`. The tool is shared with the other flat viewer and has nothing to add
here.

**`F` and `H` do nothing.** Fit and 1:1 are in the control cluster on images; the rail's view
actions and their shortcuts only exist on 3D and splat media.

**The comparison says there is no image to compare.** The version you ticked carries no image
media — pick another version, or check what its assets actually are in the *Version assets*
drawer of the bottom row.

## Related pages

- [The review workspace](review-workspace.md)
- [Video review](review-video.md)
- [Image sequences](image-sequences.md)
- [Annotations & comments](annotations-and-comments.md)
- [Exporting review notes](exporting-notes.md)
- [Review decisions & approvals](review-approvals.md)
- [Playlists & live review sessions](playlists-and-live-review.md)
- [Colour management (admin)](../admin-guide/color-management.md)
