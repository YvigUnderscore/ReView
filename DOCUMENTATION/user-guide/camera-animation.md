# Camera animation (Staging)

> Updated: 2026-08-21

3D and splat reviews can carry an **animated camera** so a shot presentation plays
identically for every viewer. The camera workshop is the **Staging** mode of the review
header — the second segment of the mode switch, key `2`.

## The Staging workshop

Entering **Staging** turns the whole workshop on at once:

- the **camera object** appears in the scene (visible even before any key exists — it sits
  on your current viewpoint until you key it);
- the **picture-in-picture** window shows the staging camera's exact framing (focal length
  in millimetres on a 36 mm sensor, at the delivery aspect). Drag it to move, use the
  **top-left handle** to resize it (the aspect stays locked to the camera frame),
  **double-click** to blow it up to three quarters of the viewer width, double-click again
  to restore. Its position is remembered for the session. The PiP switch in the *Camera*
  panel remains available as a manual override;
- arm *Place the camera* (`T`) or *Aim the camera* (`R`) in the rail to move or orient the
  camera object with a gizmo, or simply fly to a viewpoint and press `K`.

Leaving the mode turns the workshop off again; the animation itself is untouched.

## Timeline & transport

- **Scrub by dragging** the track of the transport, the ruler of the sequencer, or any key
  diamond. Scrubbing **snaps to the frame** (the pipeline framerate); hold **`Alt`** for
  free positioning. The time is shown as a `s:ff` timecode, next to an editable field in
  seconds that steps by one frame.
- **Shortcuts**: `Space` play/pause · `K` set a key from the current view · `←` / `→`
  previous/next key · `Home` / `End` playback bounds · `Ctrl/⌘+Z`, `Ctrl/⌘+Shift+Z` and
  `Ctrl/⌘+Y` undo/redo of the animation while you are in Staging mode.
  `Space` does nothing until the animation has at least one key, and `K` is only bound for
  users who can manage the media.
- **Auto-key**: when armed, moving the camera records a key — a drag of more than three
  pixels, or a wheel zoom (settled after a quarter of a second). The transport button turns
  red and pulses, and the viewport gets a **recording border**, so it cannot be forgotten.
  Changing *Focal* or *Tilt* in the Camera panel with auto-key armed also records an `fov`
  or `roll` key.
- If playback stops because you took the camera over — a click-drag, a wheel, or a flight
  key during playback — a toast says so. Press `Space` to resume.

## The sequencer (Curves drawer)

The *Curves* button of the transport opens the sequencer, docked under it and resizable by
its top edge (the height is remembered):

- a **time ruler** (timecode and frame ticks) shares the exact same horizontal scale as the
  curves below, so keys stay vertically aligned. Drag the ruler to scrub, use the wheel to
  zoom, and the **Fit** button to frame the whole animation again;
- the ruler doubles as a **dopesheet summary**: each diamond is a key column — **drag** it
  to retime every channel at once, **`Alt`+click** it to delete the column;
- the **graph** below shows one curve per channel. The wheel zooms at the cursor and
  **`Shift`+wheel pans** horizontally (that combination is the graph's, not the ruler's —
  the ruler always zooms);
- **`Shift`+click** a key toggles it in and out of the selection, and a marquee drag
  band-selects; hold `Shift` to add to what is already selected;
- each channel row has its own *key this channel* diamond — you are not forced to key all
  eight channels at once, and **double-clicking a curve** adds a single key on that channel
  at the sampled value;
- with keys selected, a floating bar offers the **tangent mode** — *Auto*, *Linear*,
  *Stepped* or *Free*. It applies to the whole selection; free handles stay draggable on the
  last key you selected;
- **`Delete`** or **`Backspace`** removes the selected keys;
- **`Ctrl/⌘+C`** copies the selection and **`Ctrl/⌘+V`** pastes it at the playhead. The
  clipboard lives in your browser, so it also works from one media to another;
- with no keys yet, the drawer explains how to start and offers the **Orbit preset**.

## The eight channels

| Group | Channels |
| --- | --- |
| Position | `px` `py` `pz` |
| Target | `tx` `ty` `tz` |
| Camera | `fov` (shown as focal length) · `roll` (shown as tilt) |

The camera is described by where it is and what it looks at, rather than by a rotation —
that is what makes a "hold on this point while pushing in" a straight line on three curves
instead of a quaternion puzzle. The focal channel is edited in millimetres on a fixed 36 mm
sensor and clamped between 7 and 400 mm.

## Orbit preset

The preset writes a full turn around the current target: eight poses plus a return to the
start, twelve seconds by default, keeping the camera's height and focal, in *Auto* tangents
and looping. It is offered in three places — the empty state of the Curves drawer, the
*Camera* panel of the dock, and the `Ctrl+K` palette. If an animation already exists you are
asked to confirm before it is replaced.

## Import & export

The **Export** panel of the dock hosts both directions:

- **Import an animation** reads a camera from **glTF/GLB** (the first animation of the file,
  from any 3D application) or from an **Alembic camera converted to JSON samples** — see
  [Alembic camera import](../admin-guide/3d-alembic.md). Two samples are the minimum. The
  imported keys land on the channels in **linear** tangents and are fully editable.
- **Camera animation (glTF)** exports what you have built, so it can go back into the DCC.

## Playback & persistence

The animation is stored with the media, as part of its **presentation**, and replayed
identically for every spectator. Because the presentation is the staging exception to the
publish lock, it stays editable after publication — unlike the content edits, which are
frozen.

*Clear the presentation* (the bin button in the *Camera* panel, confirmed) removes the saved
camera pose, the animation, the depth of field, the reveal effect and the default level of
detail in one go. The media file itself, its mask and its edits are untouched.

## Use cases

### A turntable for a modelling review, in thirty seconds

Open the model, press `2` for Staging, frame the asset the way you want the turn to start,
then take the **Orbit preset** from the empty Curves drawer. You get a twelve-second loop
around the current target at your current height. Publish, and every reviewer — including
the client on a share link — sees exactly that move, without touching a control.

### A camera move the client can watch, not fly

A splat scan is impressive and unreadable if everyone navigates it themselves. In Staging,
fly to the first viewpoint, press `K`, scrub forward two seconds, fly to the second, `K`
again. Four keys later you have a guided tour. Select the middle keys and set them to
*Auto* so the move eases instead of snapping. The presentation is saved per media and
replayed for everyone.

### Matching a move that already exists in the DCC

Layout has already made the move in Maya or Blender. Export the camera as glTF, drop it into
*Import an animation* in the Export panel, and the keys land on the eight channels in linear
tangents. From there you can retime the whole thing by dragging key columns on the ruler
rather than re-authoring anything.

### Fixing a move that drifts at the end

Play, watch the last second overshoot. Open the Curves drawer, band-select the last two
columns, drag them earlier on the ruler to tighten the ending, then set the final key to
*Stepped* if you want the camera to hold dead still on the last frame. `Ctrl+Z` walks back
through every one of those edits while you are still in Staging mode.

## Troubleshooting

**`Space` does nothing.** The animation has no keys yet. Set one with `K`, or start from the
Orbit preset.

**`K` does nothing.** Setting keys requires the right to manage the media. Reviewers can
watch the presentation but not author it.

**Playback stopped on its own.** You moved the camera — a drag, a wheel or a flight key
during playback hands control back to you and pauses. A toast says so; press `Space` to
resume.

**Every move I make writes a key.** Auto-key is armed. The transport button is red and the
viewport has a red border while it is on; click the button to disarm it.

**Undo undoes the wrong thing.** The animation's undo stack is only routed to `Ctrl+Z` while
you are in **Staging** mode. In Clean up, the same keys drive the splat or model editor
instead.

**The Shift+wheel pan does not work on the ruler.** It is a graph gesture. On the ruler the
wheel always zooms; use the **Fit** button to come back to the whole animation.

**Nothing I do is saved after publication — except this.** That is the rule: content edits
are frozen at publication, staging is not. If the geometry itself is wrong, publish a new
version.

## Related pages

- [The review workspace](review-workspace.md)
- [3D review](review-3d.md)
- [Splat review](review-splat.md)
- [Alembic camera import (admin)](../admin-guide/3d-alembic.md)
