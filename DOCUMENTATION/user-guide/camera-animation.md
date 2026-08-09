# Camera animation (Layout)

> Updated: 2026-08-07

3D and splat reviews can carry an **animated camera** so a shot presentation plays
identically for every viewer. The camera workshop is the **Layout** mode of the review
header (key `3`).

## The Layout workshop

Entering **Layout** mode turns the whole workshop on at once:

- the **camera object** appears in the scene (visible even before any key exists — it sits
  on your current viewpoint until you key it);
- the **picture-in-picture** window shows the layout camera's exact framing (focal in mm,
  36 mm sensor, delivery aspect). Drag it to move, use the top-left handle to resize,
  **double-click to enlarge** it (double-click again to restore). Its position is
  remembered for the session. The PiP switch in the *Camera* panel remains available as a
  manual override;
- arm *Place camera* (`T`) or *Aim camera* (`R`) in the rail to move or orient the camera
  object with a gizmo, or fly to a viewpoint and press **K**.

## Timeline & transport

- **Scrub by dragging** the track of the transport, the ruler of the sequencer, or any key
  diamond. Scrubbing **snaps to the frame** (pipeline framerate); hold **Alt** for free
  positioning. The current time is shown as `s:ff` timecode and is editable as a number.
- **Shortcuts**: **Space** play/pause · **K** set a key from the current view · **← / →**
  previous/next key · **Home / End** playback bounds · **Ctrl/⌘+Z / Ctrl/⌘+Maj+Z** undo/redo
  of the animation while in Layout mode.
- **Auto-key**: when armed, every camera move records a key — the button turns red and the
  viewport shows a **recording border** so it cannot be forgotten. Changing *Focal* or
  *Tilt* in the Camera panel with auto-key armed also records a `fov`/`roll` key.
- If playback stops because you took over the camera, a toast explains it (press Space to
  resume).

## The sequencer (Curves drawer)

The *Curves* button of the transport opens the sequencer, docked under it — resizable by
its top edge (height is remembered):

- a **time ruler** (timecode + frame ticks) shares the exact same horizontal scale as the
  curves below: keys stay vertically aligned. Drag the ruler to scrub, wheel to zoom,
  **Maj+wheel** to pan, and use the **Fit** button to frame the whole animation again;
- the ruler doubles as a **dopesheet summary**: each diamond is a key column — **drag** it
  to retime all channels at once, **Alt+click** to delete the column;
- each channel row has its own *key this channel* diamond — you are no longer forced to
  key all 8 channels at once (double-click a curve still adds a single key);
- select keys and choose a **tangent mode** (*Auto / Linear / Step / Free*) from the
  floating bar; free handles remain draggable on the primary key;
- **Copy / paste keys** — **Ctrl/⌘+C** / **Ctrl/⌘+V** at the playhead, also across media;
- with no keys yet, the drawer explains how to start and offers the **Orbit preset**
  (a full turn around the current target — also in the Camera panel and the Ctrl+K palette).

## Import

The *Export* panel of the dock loads a camera animation from **glTF/GLB** (exported by
most 3D apps) or from an **Alembic** camera converted to JSON samples — see
[Alembic camera import](../admin-guide/3d-alembic.md). Imported keys land on the channels
(linear) and are fully editable.

## Playback & persistence

The animation is persisted **per media** and replayed identically for every
spectator — it is part of the media's presentation, so it stays editable after
publication (staging exception to the publish lock). *Clear the presentation* (Camera
panel, confirmed) removes the saved camera, animation and staging; the media itself is
untouched.

## Related pages

- [Review 3D](review-3d.md)
- [Review splat](review-splat.md)
