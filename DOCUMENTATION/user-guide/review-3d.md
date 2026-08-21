# 3D review

> Updated: 2026-08-21

> All four media types share the same workspace — mode switch, tool rail, options bar,
> inspector dock, bottom row. See **[The review workspace](review-workspace.md)** for the
> layout, the modes and the keyboard map; this page covers what is specific to 3D models.

3D media open in a Three.js viewer designed to feel like a DCC viewport. GLB is served
directly; glTF, FBX, OBJ, COLLADA, STL and **USD** (`.usd` / `.usdc` / `.usda` / `.usdz`,
plus zipped folders) are converted to GLB at upload. USD goes through Blender, so
composition, `UsdPreviewSurface` materials, variants and `UsdSkel` animation are preserved.
See [USD & 3D conversion](../admin-guide/3d-usd.md) for setup.

The mode switch offers **Explore** (`1`), **Staging** (`2`) and **Clean up** (`3`); the
Annotate mode is armed from the comment composer or by pressing a tool letter.

## Uploading a USD scene

- **Single file** — drop a `.usd`, `.usdc`, `.usda` or `.usdz`. A `.usdz` already carries
  its textures, so nothing else is needed.
- **Scene with external assets** — zip the whole folder (root layer, referenced layers,
  textures) keeping the relative paths intact, and upload the `.zip`. ReView finds the root
  layer on its own, even when the archive holds several `.usd*` files; the *Info* panel of
  the dock then shows which one it opened.
- **Missing textures** — anything the scene references but the archive does not contain is
  simply not applied. The model still displays; re-upload a complete archive to fix the
  look.

## Navigation

Orbit by dragging, zoom with the wheel, pan with the middle button. **Hold the right mouse
button** for free flight: the mouse looks around, `W`/`A`/`S`/`D` move (physical key
positions, so `Z`/`Q`/`S`/`D` on an AZERTY keyboard), `E` goes up and `Q` down, the wheel
sets the flight speed and `Shift` multiplies it by five. Releasing the button hands the
orbit back with the target placed in front of the camera.

Every model is normalised to a common size and **stands on the floor grid**: whatever rested
on the ground in the source scene rests on the ground here. `H` returns to the home view
(facing the model, target at its centre) and `F` fits the current selection — or the whole
model when nothing is selected — keeping the view direction.

- **Saved views** — the *Camera* panel of the dock keeps up to nine shared camera poses.
  The bookmark button stores the current view and the `×` on a chip removes it (managers
  only); anyone recalls one by clicking its chip, or with `Alt`+`1` to `Alt`+`9`. The bare
  number keys belong to the mode switch in every viewer, so the recall sits under `Alt` and
  all nine views stay reachable from the keyboard. As with free flight, the key is read by
  its **position**, so the digit row works whatever the layout. Saved views are persisted
  with the media and replayed for everyone.
- **Turntable** — auto-rotation around the target (axis and speed in °/s), in the *Scene*
  panel. A session-only inspection preview: nothing is saved and the model is untouched.
- **Section plane** — also in the *Scene* panel: clip the model along an axis, type or drag
  the plane position, flip which side is kept. Session-only and non-destructive.
- **Compare** — when a version holds several 3D models, the header offers one tab per model
  plus **Show all**, which lines them up side by side with a linked camera. The models are
  normalised, so their sizes are comparable and they share the same floor. The tabs are
  hidden while editing tools are active.

## Animations

Models that carry animation clips (skeletal rigs, morph targets, transforms) get their own
track in the bottom transport — switch between *Camera* and the file's clips with the track
selector:

- **Play / pause**, a **scrubber** to move the playhead frame by frame, and a live
  `time / duration` readout.
- **Speed** (0.1×–4×) and a **loop** toggle.
- A **clip selector** when the model holds several animations; switching clips
  **cross-fades** while playing.

Skinning is reliable: rigs are normalised without their animation fighting the framing, and
skinned or morphed meshes stay visible throughout the motion, with no culling pop.

## Scene graph & ReView overrides

USD media open with a **scene graph** in the *Scene* panel of the dock: the real prim tree of
the scene, not just the nodes that happen to be drawn. Prims that exist but are not rendered
(inactive variant, filtered purpose) appear greyed out; prims carrying variant sets show a
`var` badge.

- **Select** a prim by clicking it in the tree, or by clicking the object in the viewer. The
  selection is outlined in the viewer — every mesh under the selected prim, so selecting a
  group highlights the whole branch. Clicking empty space clears the selection. Dragging
  orbits as usual: only a click that does not move selects. Objects that are not currently
  drawn cannot be picked and are never outlined.
- **Multi-selection** — **`Ctrl`/`⌘`+click** (tree or viewer) toggles a prim in the
  selection, **`Shift`+click** in the tree selects a range. The gizmo then transforms the
  **whole group** around its common centre, as one undo step.
- **Search** the tree with the field at its top (ancestors of a match stay visible),
  **`Alt`+click the eye** to isolate a prim, and use the **padlock** to make a prim
  unpickable in the viewer (the tree still selects and unlocks it).
- **Duplicate** (right-click → *Duplicate*) creates a **staging clone** — a copy of the
  prim's geometry handled entirely by the ReView override, with no reconversion. Clones
  appear as child rows with a `clone` badge, are selectable and movable like prims, can be
  deleted from the tree or the right-click menu, and travel with a comment or the saved
  override like any other scene change. Up to fifty clones per prim, and five hundred
  edited prims per override.
- **Align / distribute** — with several prims selected, right-click → *Align* lines up their
  bounding boxes on a world axis (min / centre / max) or distributes their centres evenly.
- **Frame the selection** — with a prim selected, `F` flies the camera to it and frames it;
  without a selection, `F` frames the whole model.
- **Show / hide** a prim with the eye on its row. Hiding a prim hides its children too; a
  prim hidden by one of its parents is shown greyed and cannot be re-shown on its own.
- **Right-click** a prim — in the tree **or directly on the object in the viewer** (a still
  right-click; dragging stays flight) — for its variant sets, including sets carried by an
  ancestor, plus *Frame*, *Duplicate*, *Hide*, *Isolate* and *Reset this prim*. Switching a
  variant is **instant**: every option baked into the converted file is already there, so
  nothing is reconverted and it works on published media too. An option that was not baked
  is marked as such and needs a recomposition.
- **Move / rotate / scale a prim** — select it, switch to the **Clean up** mode (key `3`)
  and press `T` (or `R` / `S`): the gizmo appears on the prim's geometry, rotating and
  scaling around its centre, and the delta is written into the ReView override. With no prim
  selected the gizmo transforms the whole model instead — that one is the version transform,
  and it is locked by publication.
- **Publishing freezes what you see** — unsaved scene changes (variants, moved prims,
  visibility) are saved as the media's override when you press *Publish*, and replayed for
  every reviewer as the default scene.
- Local exploration (isolation, visibility, moved prims) belongs to the media you are
  viewing: switching to another asset of the version resets it.

Everything you change is a **ReView override** — a lightweight delta applied when the scene
loads (moved here, scaled, hidden, this look). The USD file itself is never modified.

Overrides live at three levels:

1. **The media's override**, saved before publication by someone who can manage the media
   (*Save for everyone*). It is frozen at publication and replayed for every viewer.
2. **A proposal attached to a comment**: whatever you changed travels with the comment and
   is replayed only when that comment is selected. This is how a reviewer suggests a change
   on a published asset without altering the shared scene. Moving the camera hides the
   comment's drawing but **keeps its scene applied**, so you can inspect the proposal from
   any angle — a floating button, or `Esc`, returns to the default scene.
3. **Your local exploration**, never saved unless you do one of the above. *Cancel* returns
   to the saved state.

## Inspection

- **Render mode** — the *Display* panel of the dock switches between **Shaded**,
  **Wireframe** and **Normals**. The override is non-destructive: the original materials are
  restored when you return to Shaded.
- **Rig skeleton** — when the model carries a rig, a switch in the *Display* panel overlays
  the skeleton, drawn through the geometry, to debug skinning; it follows the animation. The
  row only appears on rigged models.
- **Technical sheet** — the *Info* panel lists the live scene statistics (meshes, triangles,
  vertices, materials) and, below them, the file name, the UV sets and the glTF extensions
  used by the model. On a USD media it also shows the **root layer** that was actually
  opened.

## Material variants & embedded cameras

When the converted file declares them, the *Display* panel adds a *File variants* group —
it is hidden entirely when the model has neither:

- **Material variants** (`KHR_materials_variants`) — a dropdown switches the whole model
  between authored looks (colour options, for instance). The swap is non-destructive.
- **Embedded cameras** — cameras authored in the file are offered as a list; picking one
  moves the review camera to that viewpoint, with its position, aim and field of view.

## Lighting & environment

The *Lighting* panel exists on 3D models only — a splat carries its own baked light.

- **HDRI environment** from the studio library, with **exposure** in EV (−5 to +5), a **Y
  rotation**, a switch to show the HDRI **as the background**, and a **shadow ground** — an
  invisible plane under the model that catches its shadows and grounds it visually.
- A reviewer's adjustments are **session-only**. Someone who can manage the media saves them
  with *Default lighting of the project*, and from then on they are replayed for everyone
  who opens that media; the bin button next to it clears the saved lighting.
- When a media has no lighting of its own, the **project default** applies — set in
  *Project → Settings → Default 3D lighting* (HDRI, exposure, rotation, background, shadow
  ground). Failing that, the viewer falls back to neutral studio lighting.
- The panel also repeats the project's OCIO **display** and **view** as a read-only badge.

## Recomposing a USD scene

If you can manage the media and it is not published yet, the *Info* panel offers **Recompose
from the USD**. The dialog lets you pick another **purpose** (Render, Proxy or Guide) and a
different option for each variant set, then re-runs the conversion through an overlay layer.
The original USD file is never modified. Once the media is published, recomposing is
refused — publish a new version.

## Transform

A unified transform gizmo (`T` move, `R` rotate, `S` scale in the **Clean up** mode, with
undo and redo) orients and scales the whole model before publication. That transform is
stored on the version and locked by the publish lock. With prims selected, the same gizmo
writes into the ReView override instead.

## Camera & frame

- Review cameras use a **focal length in millimetres on a fixed 36 mm sensor**, adjustable
  from 7 to 400 mm in the *Camera* panel, with a **tilt** around the view axis.
- The viewer fills the space and a **letterbox guide** shows the delivery aspect resolved
  from the pipeline settings. Annotations are anchored to that frame, so they line up for
  every reviewer whatever their window size. The aspect itself is a read-only readout in the
  *Camera* panel.
- A **camera object** can be placed in the scene, oriented with a gizmo and animated (see
  [Camera animation](camera-animation.md)); a picture-in-picture window shows its point of
  view.
- **Import a camera** — the *Export* panel of the dock reads a camera animation from
  **glTF/GLB** (from any 3D application) or from an **Alembic** camera exported to JSON
  samples (see [Alembic camera import](../admin-guide/3d-alembic.md)). The same panel
  exports the animation back to glTF and captures the current view as a PNG.

## Numeric fields

Numeric values (exposure, focal length, angles…) use the same drag-label field everywhere:
drag the label horizontally to scrub the value, or click and type it. No sliders.

## Use cases

### A modelling review on a hero asset

Open the model, `H` for the home view, and go around it by dragging. Switch the *Display*
panel to **Wireframe** to check the topology density on the silhouette, then to **Normals**
to catch the inverted face nobody noticed in the DCC. Nothing you do here is written to the
file — the mode override is restored the moment you go back to Shaded. Drop a *Pin* on the
bad face in Annotate mode and the modeller lands on it from the comment.

### The prop is in the wrong place, and you can prove it

The set dressing puts a crate through a wall. Select the crate in the scene graph, press `3`
for Clean up, `T`, and drag it where it should be. If the media is not published yet, *Save
for everyone* makes that the scene everybody opens. If it is published, do not fight the
lock: send the move as a **comment proposal** — the delta travels with your note and is
replayed only when someone selects it, so the published asset stays exactly as delivered.

### Choosing between two authored looks

The USD carries a `lookVariant` with *clean* and *dirty*. Right-click the prim in the tree
and switch: the option is already baked into the converted file, so the change is instant
and works on published media. If the combination you want was not baked, the menu says so —
recompose from the *Info* panel, before publication.

### Lighting a whole show the same way

Set the HDRI, the exposure and the rotation once on a representative asset, then put the
same values in *Project → Settings → Default 3D lighting*. Every 3D media of the project
that has no lighting of its own opens with it. Reviewers can still tweak their own session
without disturbing anyone.

### Checking an animated rig

Switch the bottom transport to the model's clip track, play, and turn on the **rig skeleton**
in the *Display* panel: the bones are drawn through the geometry, so a shoulder that
collapses at frame 40 is visible rather than deduced. Cross-fading between clips while
playing lets you check a transition without reloading.

## Troubleshooting

**"3D conversion in progress…"** The worker has not finished converting the file to GLB.
Reload in a moment.

**"3D model cannot be displayed: the file could not be converted to GLB."** The conversion
failed. The reason reported by the worker — a missing USD asset, a refused archive, a
missing tool — is printed underneath, and anyone who is not a `CLIENT` gets a *Restart the
conversion* button. If the reason points at your file, fix it and re-upload; a GLB or glTF
always loads.

**Nothing renders and the viewer stays black.** The viewer needs WebGL. Check that hardware
acceleration is enabled in the browser and that the tab has not lost its GL context after a
long session; reloading the page rebuilds the scene.

**A variant option is greyed out or marked as not baked.** The conversion only bakes the
combinations it was asked for. Recompose the scene from the *Info* panel with that selection
— possible on unpublished media only.

**Moving a prim is refused, or nothing saves.** Saving the media's override needs both the
right to manage the media and an unpublished version. After publication the override is
frozen; attach your change to a comment instead.

**The model floats above or sinks into the grid.** Models are normalised with the bottom of
their bounding box at ground level. A stray helper object or a wide bounding box in the
source scene will therefore shift what "the ground" means — clean the export, or hide the
offending prim in the scene graph.

**A number key changes mode instead of recalling a saved view.** The bare digits are the
mode switch, in every viewer and with nothing else on them. Saved views answer to `Alt`+`1`
to `Alt`+`9`, and only for a slot that actually holds a view: with two views saved, `Alt`+`3`
and beyond stay silent.

**The bookmark button is greyed out.** The nine slots are all taken. Remove a view with the
`×` on its chip to free one.

## Related pages

- [The review workspace](review-workspace.md)
- [Camera animation](camera-animation.md)
- [Splat review](review-splat.md)
- [Annotations & comments](annotations-and-comments.md)
- [USD & 3D conversion (admin)](../admin-guide/3d-usd.md)
- [Alembic camera import (admin)](../admin-guide/3d-alembic.md)
- [HDRI library (admin)](../admin-guide/hdri-library.md)
