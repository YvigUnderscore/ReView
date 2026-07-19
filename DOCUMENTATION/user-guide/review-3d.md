# 3D review

> Updated: 2026-07-19

3D media (GLB — other formats are converted at upload) open in a Three.js viewer
designed to feel like a DCC viewport.

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

## Inspection

- **Display modes** — the inspect bar (top-right HUD) switches between *shaded*,
  *wireframe*, *normals*, *matcap* and *UV checker*. The override is
  **non-destructive**: the original materials are restored when you return to shaded.
- **Technical sheet** — polycount (triangles, vertices, meshes), materials, UV sets
  and glTF extensions used by the model.
- **Texture inspector** — per-channel previews (base color, normal, roughness,
  metalness, AO, emissive) with their dimensions.

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

## HUD

Numeric values (exposure, focal…) are edited through the floating HUD — drag or
type, no permanent slider panels.

## Related pages

- [Camera animation](camera-animation.md)
- [Review splat](review-splat.md)
- [HDRI library (admin)](../admin-guide/hdri-library.md)
