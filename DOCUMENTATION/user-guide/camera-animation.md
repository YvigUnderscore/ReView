# Camera animation

> Updated: 2026-07-18

3D and splat reviews can carry an **animated camera** so a shot presentation plays
identically for every viewer.

## Channel-based F-curves

The animation model is **per-channel** (position, rotation, focal, depth of field…),
each channel holding keyframes interpolated with **Hermite curves** — like a DCC
curve editor.

## Editing

- **Dopesheet**: keys per channel over time; move/copy/delete, multi-select.
- **Graph editor**: edit curve values and tangents by hand; auto-key mode records
  changes while you move the camera; the animation duration is editable.
- The **camera object** is visible in the scene: place and orient it with the
  transform gizmo (including rotation), or fly to a viewpoint and key it.
- A **picture-in-picture** preview shows the camera's exact framing (focal in mm,
  36 mm sensor, delivery aspect).

## Playback & persistence

The animation is persisted **per media** and replayed identically for every
spectator — it is part of the media's presentation, so it stays editable after
publication (staging exception to the publish lock).

## Related pages

- [Review 3D](review-3d.md)
- [Review splat](review-splat.md)
