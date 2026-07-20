# Camera animation

> Updated: 2026-07-20

3D and splat reviews can carry an **animated camera** so a shot presentation plays
identically for every viewer.

## Channel-based F-curves

The animation model is **per-channel** (position, rotation, focal, depth of field…),
each channel holding keyframes interpolated with **Hermite curves** — like a DCC
curve editor.

## Editing

- **Graph editor**: keys per channel over time; edit values and tangents by hand,
  multi-select, move/delete. Auto-key mode records changes while you move the camera;
  the animation duration is editable.
- **Copy / paste keys** — select keys and press **Ctrl/⌘ + C**, then **Ctrl/⌘ + V** to
  paste them at the playhead (value, tangent mode and handles are preserved). The
  clipboard also works **across media** — copy a curve on one shot, paste it on another.
- The **camera object** is visible in the scene: place and orient it with the
  transform gizmo (including rotation), or fly to a viewpoint and key it.
- A **picture-in-picture** preview shows the camera's exact framing (focal in mm,
  36 mm sensor, delivery aspect).

## Import

The editor's **Import** button loads a camera animation from **glTF/GLB** (exported by
most 3D apps) or from an **Alembic** camera converted to JSON samples — see
[Alembic camera import](../admin-guide/3d-alembic.md). Imported keys land on the channels
(linear) and are fully editable.

## Playback & persistence

The animation is persisted **per media** and replayed identically for every
spectator — it is part of the media's presentation, so it stays editable after
publication (staging exception to the publish lock).

## Related pages

- [Review 3D](review-3d.md)
- [Review splat](review-splat.md)
