# 3D review

> Updated: 2026-07-20

3D media open in a Three.js viewer designed to feel like a DCC viewport. GLB is served
directly; glTF, FBX, OBJ, COLLADA, STL and **USD** (`.usd`/`.usdc`/`.usda`/`.usdz`, plus
zipped folders) are converted to GLB at upload. USD is converted by a dedicated native
USD→glTF converter when the studio has enabled one — otherwise by assimp. See
[USD & 3D conversion](../admin-guide/3d-usd.md) for setup.

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
transport bar at the bottom of the HUD:

- **Play / pause**, a **scrubber** to move the playhead frame by frame, and a live
  `time / duration` readout.
- **Speed** (0.1×–4×) and a **loop** toggle.
- A **clip selector** when the model holds several animations; switching clips
  **cross-fades** while playing.

Skinning is reliable: rigs are normalized without their animation fighting the framing,
and skinned/morphed meshes stay visible throughout the motion (no culling pop).

## Inspection

- **Display modes** — the inspect bar (top-right HUD) switches between *shaded*,
  *wireframe*, *normals*, *matcap* and *UV checker*. The override is
  **non-destructive**: the original materials are restored when you return to shaded.
- **Skeleton debug** — when the model has a rig, a **bone** toggle in the inspect bar
  overlays the skeleton (drawn through the geometry) to debug skinning; it follows the
  animation. Shown only for rigged models.
- **Technical sheet** — polycount (triangles, vertices, meshes), materials, UV sets
  and glTF extensions used by the model. It also shows the **source format** and which
  **converter** produced the GLB (a `natif` badge marks USD converted natively, i.e.
  with UsdPreviewSurface materials and variants preserved).
- **Texture inspector** — per-channel previews (base color, normal, roughness,
  metalness, AO, emissive) with their dimensions.

## Material variants & embedded cameras

When the GLB declares them (top-right HUD, shown only if present):

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

## HUD

Numeric values (exposure, focal…) are edited through the floating HUD — drag or
type, no permanent slider panels.

## Related pages

- [Camera animation](camera-animation.md)
- [Alembic camera import (admin)](../admin-guide/3d-alembic.md)
- [Review splat](review-splat.md)
- [HDRI library (admin)](../admin-guide/hdri-library.md)
