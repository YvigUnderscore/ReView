# The review workspace

> Updated: 2026-08-21

Every media type — video, image, 3D model, Gaussian splat — opens in the **same
workspace**. Only the tools change; their places never do. Nothing floats over the media:
the image you are asked to judge stays clear, and the only overlays left are the ones
anchored to the view (annotation strokes, pins, the wipe bar, composition guides, the
camera PiP, the axis triad, the readout in the corner).

## The five places

| Place | What it is for |
| --- | --- |
| **Mode switch** — top bar, centre | Decides what exists on screen. Number keys pick a mode |
| **Tool rail** — left column | The exclusive pointer tools of the current mode, then the view actions |
| **Options bar** — one row under the header | Settings of the **active tool only** |
| **Inspector dock** — right column | Settings that are not tools. One panel at a time |
| **Bottom row** | Time (video, animation) or the version assets drawer |

Reading the workspace is therefore always the same: *what am I doing* (mode) → *with what
gesture* (rail) → *tuned how* (options bar), and separately *how is it displayed* (dock).

## Modes

The mode switch sits in the middle of the header, and each mode is also bound to a number
key — **the position in the switch is the key**: first mode `1`, second `2`, third `3`.

| Media | Modes in the switch | Keys |
| --- | --- | --- |
| Video | Watch · Compare · Trim | `1` `2` `3` |
| Image | Watch · Compare | `1` `2` |
| 3D model / splat | Explore · Staging · Clean up | `1` `2` `3` |

**Annotate is a mode, but it is not in the switch.** You enter it from the comment space
(the *Annotate* button of the composer, or right-click in the viewer on video and image),
or simply by pressing a drawing tool letter — `D`, `R`, `E`, `A`, `G`, `T`, `M`, `X` all
arm the tool *and* switch to Annotate. On video and image, finishing the annotation takes
you back to the first mode.
The same rule applies to the other modes: pressing the letter of a tool that belongs to
another mode switches to that mode. The one exception is the video transport, which keeps
`I`, `O`, `J`, `K` and `L` for itself — pressing `I` sets a loop in point instead of
jumping to Trim.

The first mode (**Watch** / **Explore**) is the only one served to clients: an account
with the `CLIENT` role does not see the switch and stays in read-only exploration.

Changing mode never destroys anything: it only changes which tools exist. If the tool you
were holding does not exist in the new mode, you fall back to navigation.

## Tool rail

One tool is armed at a time — it decides what a click does in the view. The first tool is
always **Navigate** (`V`), the resting state of every mode. Each tool shows its shortcut in
its tooltip, and next to its label when the rail is expanded (chevron at the bottom of the
rail; the choice is remembered per media type).

Tools a viewer does not implement are not shown at all, rather than shown inert: the video
player has no zoom tool, a 3D model has no surface brush or screen region, and the splat
selection tools never appear on a model.

**Flat media (video, image)**

| Mode | Tools |
| --- | --- |
| Watch | Navigate `V` · Zoom `Z` (image only) |
| Annotate | Navigate `V` · Freehand `D` · Rectangle `R` · Ellipse `E` · Arrow `A` · Polygon `G` · Text `T` · Move a shape `M` · Eraser `X` |
| Compare | Navigate `V` · Wipe bar `W` · Zoom `Z` (image only) |
| Trim (video) | Navigate `V` · In point `I` · Out point `O` · Annotation range `P` |

**Spatial media (3D model, splat)**

| Mode | Tools |
| --- | --- |
| Explore | Navigate `V` · Focus `C` (splat only) · Point of interest `I` |
| Annotate | Navigate `V` · 3D brush `P` (splat only) · Pin `I` |
| Staging | Navigate `V` · Place the camera `T` · Aim the camera `R` · Focus `C` (splat only) |
| Clean up | Navigate `V` · Rectangle `B` · Lasso `L` · Surface brush `P` · Cutting volume `O` (all four splat only) · Move `T` · Rotate `R` · Scale `S` |

Below a separator, the spatial viewers add two **view actions**: **Fit the selection or the
object** (`F`) and **Home view** (`H`). Video and image do not have them — the image viewer
carries its own zoom / `1:1` / fit cluster in the bottom-right corner of the picture, and
`F` and `H` do nothing on flat media.

`Esc` drops the armed tool and returns to Navigate.

## Options bar

The row under the header shows the settings of the **active tool only** — ink, thickness
and opacity for a drawing tool, radius for the surface brush, axes and snapping for a
gizmo. That is what allows the workspace to keep every setting without stacking anything:
changing tool changes the row. The row scrolls horizontally when it is too dense.

In modes that write (Clean up, Staging, video Trim), a **commit group** is pinned at the
right-hand end, outside the scrolling area, so the primary action is always reachable:
undo, redo, and the save button. An unsaved state shows as a dot inside the button; a clean
state shows a check. There is never a status label next to it — the footer of the workspace
carries the *Saved* / *Not saved* badge.

## Inspector dock

The right column holds what you set once and forget: playback, colour management, guides,
comparison, technical sheet, exports — and in 3D, camera, lighting, display and scene.

- One panel at a time. Clicking the open tab closes it again, leaving the strip of icons.
- `Tab` collapses the dock, or reopens it on the first panel of the media.
- The dock **starts collapsed** so the media gets the full width; whether it is open, which
  panel is selected, whether the rail shows labels and the height of the bottom drawer are
  remembered per media type in your browser.

Panels by media type:

| Media | Panels |
| --- | --- |
| Video | Playback · Image · Guides · Comparison · Info · Export |
| Image | Display · Image · Guides · Comparison · Info · Export |
| 3D model | Camera · Lighting · Display · Scene · Info · Export |
| Splat | Camera · Display · Scene · Info · Export |

Lighting only exists for 3D models: a splat carries its own baked light.

## Bottom row

- **Video**: the player's own timeline and transport (play, frame stepping, loop, frame and
  timecode readout, fps, quality, volume, fullscreen), plus a *Version assets* drawer
  showing the other assets of the version as thumbnails — click one to review it.
- **Image**: the *Version assets* drawer only. Zoom, `1:1`, fit and fullscreen live in the
  control cluster at the bottom-right of the picture itself.
- **3D / splat**: the animation transport — track selector (*Camera*, or the clips carried
  by the file), play, key-to-key jumps, key insertion, playhead, loop — and the **Curves**
  drawer, docked under the transport and resizable by its top edge.

## Keyboard

| Keys | Action |
| --- | --- |
| `1`–`3` | Mode, in switch order (`1`–`2` on an image) |
| `Alt`+`1`–`9` | Recall a saved camera view — **3D only** |
| `V` | Navigate (rest) |
| Tool letters | Arm the tool — and switch to its mode if it belongs to another one |
| `Esc` | Back to navigation |
| `Tab` | Collapse / reopen the dock |
| `F` / `H` | Fit · home view — **3D and splat only** |
| `Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z` | Undo · redo, in modes that write |
| `?` | Open the keyboard shortcut panel |
| `Ctrl+K` | Command palette |

The shortcut panel is also reachable from the keyboard icon in the review header. Its
*Navigation* section is editable: click a key to rebind it, and the binding follows your
account.

No shortcut fires while the caret is in a text field (comment composer, numeric field,
search box) or while a dialog is open — so typing a comment never arms a tool by accident.

## Use cases

### End-of-day dailies on a compositing shot

Open the latest version from the Reviews page, stay in **Watch**, and play with `L`. When
something is wrong, press `K` to stop dead, step back to the exact frame with `←`, then
press the *Annotate* button of the composer: the rail turns into drawing tools and the mode
switch releases. Circle the problem with `E`, write the note, send. The comment is anchored
to that frame; a click on its card later brings the player back to it.

### Handing the same shot to three different people

Once notes are in, open the **Comparison** panel of the dock only if you want to check the
mode; the versions themselves are chosen in the header (*Compare…*). What you keep per
person is the workspace state: an artist who reviews on a laptop collapses the dock with
`Tab` and works full width; a supervisor who lives in the technical sheet leaves *Info*
open. Both preferences are stored per media type, so they survive from one shot to the
next.

### A modelling supervisor going through an asset

Open the model, stay in **Explore**, press `H` to get the home view, `F` to fit whatever is
selected. Nothing is written, nothing is saved — Explore has no editing tool at all, which
is exactly why it is the mode served to clients on a share link.

## Troubleshooting

**A number key changes the mode instead of doing what I expect.** The bare number keys are
the mode switch, in every viewer and with nothing else on them. The saved camera views of a
3D model, which used to share those keys, answer to `Alt`+`1` to `Alt`+`9`.

**Pressing a letter jumps me to another mode.** That is intended: a tool letter arms its
tool wherever it lives. If you only wanted to type, click into the composer first — while
the caret is in a text field no shortcut fires.

**The rail is missing the fit and home buttons.** They only exist on 3D and splat media.

**The mode switch is missing entirely.** Either you are signed in with the `CLIENT` role
(read-only exploration by design), or the media has a single mode.

**The workspace is too cramped on a laptop.** The workspace has no minimum width any more:
the rail and the dock fold themselves away and the header wraps rather than pushing the page
into horizontal scrolling. Keep the dock closed with `Tab`, and use the chevron at the bottom
of the rail to hide the tool labels.

## Related pages

- [Video review](review-video.md) · [Image review](review-image.md) ·
  [3D review](review-3d.md) · [Splat review](review-splat.md)
- [Annotations & comments](annotations-and-comments.md)
- [Camera animation](camera-animation.md)
- [Review decisions & approvals](review-approvals.md)
