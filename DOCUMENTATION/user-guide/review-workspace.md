# The review workspace

> Updated: 2026-08-01

Every media type — video, image, 3D model, Gaussian splat — opens in the **same
workspace**. Only the tools change; their places never do. Nothing floats over the media
any more: the image you are asked to judge stays clear, and the only overlays left are the
ones anchored to the view (annotation strokes, pins, the wipe bar, composition guides, the
camera PiP, the axis triad, the readout in the bottom-left corner).

## The five places

| Place | What it is for |
| --- | --- |
| **Mode switch** — top bar, centre | Decides what exists on screen. Three or four modes, keys `1`–`4` |
| **Tool rail** — left column | The exclusive pointer tools of the current mode, then two view actions |
| **Options bar** — one row under the header | Settings of the **active tool only** |
| **Inspector dock** — right column | Settings that are not tools. One panel at a time |
| **Bottom row** | Time (video, animation) or the media strip |

Reading the workspace is therefore always the same: *what am I doing* (mode) → *with what
gesture* (rail) → *tuned how* (options bar), and separately *how is it displayed* (dock).

## Modes

Modes are taken with keys `1` to `4` in every viewer. The first mode is the only one served
to clients: an account with the **Client** role does not see the switch and stays in
read-only exploration.

| Media | Modes |
| --- | --- |
| Video | Watch · Annotate · Compare · Trim |
| Image | Watch · Annotate · Compare · Adjust |
| 3D model / splat | Explore · Annotate · Staging · Clean up |

Changing mode never destroys anything: it only changes which tools exist. If the tool you
were holding does not exist in the new mode, you fall back to navigation.

## Tool rail

One tool is armed at a time — it decides what a click does in the view. The first tool is
always **Navigate** (`V`), the resting state of every mode. Each tool shows its shortcut in
its tooltip, and next to its label when the rail is expanded (chevron at the bottom of the
rail; the choice is remembered).

Tools a viewer does not implement are not shown at all, rather than shown inert. Below a
separator sit the two view actions: **Frame** (`F`) and **Home view** (`H`) in 3D, **Fit to
screen** (`F`) and **Actual size 1:1** (`H`) for flat media.

`Esc` returns to navigation.

## Options bar

The row under the header shows the settings of the **active tool only** — ink, thickness,
opacity for a drawing tool; radius for the surface brush; axes and snapping for a gizmo.
That is what allows the workspace to keep every setting without stacking anything: changing
tool changes the row.

In modes that write (Clean up, Staging, video Trim), a **commit group** is pinned at the
right-hand end, outside the scrolling area, so the primary action is always reachable:
undo, redo, and the save button. An unsaved state shows as a dot inside the button; a clean
state shows a check. There is never a status label next to it.

## Inspector dock

The right column holds what you set once and forget: playback, colour management, guides,
comparison, technical sheet, exports — and in 3D, camera, lighting, display and scene.

- One panel at a time. Clicking the open tab closes it again, leaving the 44 px strip of
  icons.
- `Tab` collapses and reopens the dock.
- The dock **starts collapsed** so the media gets the full width; whether it is open, which
  panel, and whether the rail shows labels are remembered per media type.

Panels by media type:

| Media | Panels |
| --- | --- |
| Video | Playback · Image · Guides · Comparison · Info · Export |
| Image | Display · Image · Guides · Comparison · Info · Export |
| 3D model | Camera · Lighting · Display · Scene · Info · Export |
| Splat | Camera · Display · Scene · Info · Export |

Lighting only exists for 3D models: a splat carries its own baked light.

## Bottom row

- **Video**: the player's own timeline and transport (playback, frame stepping, loop,
  sound, quality), plus a *Filmstrip* drawer listing the media of the version.
- **Image**: zoom, rotation and mirror, plus the same drawer.
- **3D / splat**: the animation transport — track selector (staging camera, or the clips
  carried by the file), play, key-to-key jumps, key insertion, playhead, loop — and the
  **Curves** drawer, docked under the transport. The curve editor no longer opens in a
  floating window you had to move out of the way.

## Keyboard

| Keys | Action |
| --- | --- |
| `1`–`4` | Mode |
| `V` | Navigate (rest) |
| Tool letters | Arm the tool of the current mode (`D` freehand, `R` rectangle, `T` translate…) |
| `Esc` | Back to navigation |
| `Tab` | Collapse / reopen the dock |
| `F` / `H` | Frame · home view (or fit · 1:1) |
| `Ctrl+Z` / `Ctrl+Y` | Undo · redo, in modes that write |

Tool letters are defined per mode, so the same key can arm different tools in different
modes — the rail always shows which one is armed.

## Related pages

- [Video review](review-video.md) · [Image review](review-image.md) ·
  [3D review](review-3d.md) · [Splat review](review-splat.md)
- [Annotations & comments](annotations-and-comments.md)
- [Camera animation](camera-animation.md)
