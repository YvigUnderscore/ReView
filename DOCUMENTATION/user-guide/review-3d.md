# 3D review

> Updated: 2026-08-01

> All four media types share the same workspace — mode switch, tool rail, options bar,
> inspector dock, bottom row. See **[The review workspace](review-workspace.md)** for the
> layout, the modes and the keyboard map; this page covers what is specific to 3D models.

3D media open in a Three.js viewer designed to feel like a DCC viewport. GLB is served
directly; glTF, FBX, OBJ, COLLADA, STL and **USD** (`.usd`/`.usdc`/`.usda`/`.usdz`, plus
zipped folders) are converted to GLB at upload. USD goes through Blender, so composition,
`UsdPreviewSurface` materials, variants and `UsdSkel` animation are preserved. See
[USD & 3D conversion](../admin-guide/3d-usd.md) for setup.

## Uploading a USD scene

- **Single file** — drop a `.usd`, `.usdc`, `.usda` or `.usdz`. A `.usdz` already carries
  its textures, so nothing else is needed.
- **Scene with external assets** — zip the whole folder (root layer, referenced layers,
  textures) keeping the relative paths intact, and upload the `.zip`. ReView finds the root
  layer on its own, even when the archive holds several `.usd*` files.
- **Missing textures** — anything the scene references but the archive does not contain is
  listed in the technical sheet under *Scène USD*. The model still displays; re-upload a
  complete archive to fix the look.

## Navigation

Unified DCC-style navigation: orbit, pan, dolly with the mouse, plus a **fly mode**
for walkthroughs. Framing and tilt behave consistently across 3D and splat review.

- **Camera bookmarks** — save the current view as a numbered, **shared** bookmark
  (managers only, `+ Vue`); anyone recalls it by clicking its number or pressing keys
  **1–9**. Bookmarks are persisted with the media and replayed for everyone.
  Right-click a bookmark to remove it.
- **Turntable** — auto-rotate the view around the target (axis X/Y/Z, speed in °/s).
  A session-only inspection preview: nothing is saved and the model is untouched.
- **Section plane** — clip half of the model along an axis; drag or type the plane
  position and flip which side is kept. Session-only and non-destructive.
- **A/B compare** — when a version holds several 3D models, switch between them with a
  linked camera (they share the scene), or *Voir tous* to line them up side by side.
  The models are auto-normalized so their sizes are comparable.

## Animations

Models that carry animation clips (skeletal rigs, morph targets, transforms) get a
their own track in the bottom transport (track selector: *Camera* / *Model*):

- **Play / pause**, a **scrubber** to move the playhead frame by frame, and a live
  `time / duration` readout.
- **Speed** (0.1×–4×) and a **loop** toggle.
- A **clip selector** when the model holds several animations; switching clips
  **cross-fades** while playing.

Skinning is reliable: rigs are normalized without their animation fighting the framing,
and skinned/morphed meshes stay visible throughout the motion (no culling pop).

## Scene graph & ReView overrides

USD media open with a **scene graph** in the *Scene* panel of the dock: the real prim tree of
the scene, not just the nodes that happen to be drawn. Prims that exist but are not rendered
(inactive variant, filtered purpose) appear greyed out; prims carrying variant sets show a
`var` badge.

- **Select** a prim by clicking it in the tree, or by clicking the object in the viewer.
  The selection is outlined in the viewer — every mesh under the selected prim, so selecting a
  group highlights the whole branch. Clicking empty space clears the selection. Dragging orbits
  the camera as usual — only a click that does not move selects. Objects that are not currently
  drawn (inactive variant, hidden prim) cannot be picked and are never outlined.
- **Frame the selection** — with a prim selected, `F` flies the camera to it (keeping the
  current view direction) and frames it; without a selection, `F` frames the whole model.
- **Show / hide** a prim with the eye on its row. Hiding a prim hides its children too; a prim
  hidden by one of its parents is shown greyed and cannot be re-shown on its own.
- **Right-click** a prim — in the tree **or directly on the object in the viewer** (a still
  right-click; dragging stays fly navigation) — for its variant sets (including sets carried by
  an ancestor), plus *Frame*, *Hide*, *Isolate* and *Reset this prim*. Switching a variant is
  **instant**: every option is baked into the converted file, so nothing is reconverted and it
  works on published media too.
- **Move / rotate / scale a prim** — select a prim, switch to the *Clean* mode and press `T`
  (or `R` / `S`): the transform gizmo attaches to that prim instead of the whole model, and the
  delta is written into the ReView override. Before publication a manager saves it for everyone;
  after publication it travels with the next comment, like any other proposal. With no prim
  selected the gizmo keeps transforming the whole model (version transform, pre-publish only).
- The tree also lists geometry the analyzer cannot compose — baked variant options live in the
  scene as implicit prims, so they can be selected and isolated like any other. Rows are greyed
  when their geometry is not currently drawn (inactive variant, missing from the GLB).
- Local exploration (isolation, visibility, moved prims) belongs to the media you are viewing:
  switching to another asset of the version resets it.

Everything you change is a **ReView override** — a lightweight delta ReView applies when the
scene loads (moved here, scaled, hidden, this look). The USD file itself is never modified.

Overrides live at three levels:

1. **The media's override**, set before publication by someone who can manage the media
   (*Save for everyone*). It is **frozen at publication** and replayed for every viewer.
2. **A proposal attached to a comment**: whatever you changed travels with the comment and is
   replayed only when that comment is selected. This is how reviewers suggest changes on a
   published asset without altering the shared scene.
3. **Your local exploration**, which is never saved unless you do one of the above. *Cancel*
   returns to the saved state.

## Inspection

- **Display modes** — the *Display* panel of the dock switches between *shaded*,
  *wireframe*, *normals*, *matcap* and *UV checker*. The override is
  **non-destructive**: the original materials are restored when you return to shaded.
- **Skeleton debug** — when the model has a rig, a **bone** toggle in the inspect bar
  overlays the skeleton (drawn through the geometry) to debug skinning; it follows the
  animation. Shown only for rigged models.
- **Technical sheet** — polycount (triangles, vertices, meshes), materials, UV sets
  and glTF extensions used by the model. It also shows the **source format** and which
  **converter** produced the GLB (a `natif` badge marks USD converted natively, i.e.
  with UsdPreviewSurface materials and variants preserved).
- **USD scene** — for USD media the sheet adds a *Scène USD* section: the **root layer**
  actually opened, up axis, unit scale, layer count, purpose, animation range, rig, the
  **variant sets** in effect, and a warning listing **unresolved references**.
- **Recomposing** — if you can manage the media and it is not published yet, *Recomposer la
  scène…* at the bottom of that section re-runs the conversion with another variant
  selection or another purpose (render / proxy / guide). The original USD file is never
  modified. Once the media is published, recomposing is locked — publish a new version.
- **Texture inspector** — per-channel previews (base color, normal, roughness,
  metalness, AO, emissive) with their dimensions.

## Material variants & embedded cameras

When the GLB declares them (*Display* panel of the dock, shown only if present):

- **Material variants** (`KHR_materials_variants`) — a dropdown switches the whole model
  between authored looks (e.g. color options); *Défaut* restores the original materials.
  The swap is non-destructive.
- **Embedded cameras** — cameras authored in the file are offered as a *Vue caméra…*
  menu; picking one moves the review camera to that viewpoint (position, look and FOV).

## Lighting & environment

- **HDRI environments** from the studio library (managed by admins in
  *Admin → Contextes de review → 3D & Splat*) light the model; the chosen HDRI and
  exposure are **persisted per media**, so every reviewer sees the same setup.
- **Project default lighting** — a project can define a default HDRI (with exposure,
  rotation, background and ground shadow) in *Project → Settings → Éclairage 3D par
  défaut*. It is inherited studio → project and replayed when a 3D medium has no
  lighting of its own. Reviewers can still tweak lighting for their session without
  changing the saved default.
- **Ground shadow** — an optional invisible floor (toggle *Ombres* in the lighting
  bar) receives the model's cast shadows from the key light, grounding it visually.
  Like the rest of the lighting, it is non-destructive.

## Transform

A unified transform tool (translate/rotate/scale gizmo with **undo/redo**) lets you
orient and scale the model before publication. The transform is stored on the
version and locked by the publish lock.

## Camera & frame

- Review cameras use a **focal length in millimeters on a fixed 36 mm sensor**.
- The viewer fills the space; a **letterbox guide** shows the delivery aspect.
  Annotations are anchored to that frame.
- A **camera object** can be placed in the scene, oriented with the gizmo, and
  animated (see [Camera animation](camera-animation.md)); a picture-in-picture
  preview shows the camera's point of view.
- **Import a camera** — the animation editor's *Import* button reads a camera animation
  from **glTF/GLB** (from any 3D app) or from an **Alembic** camera exported to JSON
  samples (see [Alembic camera import](../admin-guide/3d-alembic.md)).

## Numeric fields

Numeric values (exposure, focal length, angles…) use the same drag-label field everywhere:
drag the label horizontally to scrub (Shift ×10), or type the value. No sliders.

## Related pages

- [Camera animation](camera-animation.md)
- [Alembic camera import (admin)](../admin-guide/3d-alembic.md)
- [Review splat](review-splat.md)
- [HDRI library (admin)](../admin-guide/hdri-library.md)
