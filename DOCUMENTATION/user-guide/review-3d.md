# 3D review

> Updated: 2026-07-18

3D media (GLB — other formats are converted at upload) open in a Three.js viewer
designed to feel like a DCC viewport.

## Navigation

Unified DCC-style navigation: orbit, pan, dolly with the mouse, plus a **fly mode**
for walkthroughs. Framing and tilt behave consistently across 3D and splat review.

## Lighting & environment

- **HDRI environments** from the studio library (managed by admins in
  *Admin → Contextes de review → 3D & Splat*) light the model; the chosen HDRI and
  exposure are **persisted per media**, so every reviewer sees the same setup.

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
