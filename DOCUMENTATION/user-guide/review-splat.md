# Gaussian splat review

> Updated: 2026-07-18

Gaussian splat media are rendered with **Spark (SparkJS)** inside the Three.js
scene, with the same DCC-style navigation as 3D review — plus a full
**non-destructive editor**.

## Non-destructive editing

The original splat file is **never modified**. Every edit is stored as metadata
(selection mask bitset + edit list) and **replayed identically for every viewer**:

- **Selection**: surface-aware brush (only selects visible surface splats) and
  ellipsoid/box volumes; grow/shrink and invert.
- **Delete/mask**: hide unwanted splats (floaters, background).
- **Tint & paint**: recolor selections or paint directly.
- **Transform**: TRS on the whole splat or on a selection.
- **Crop volumes** to isolate a region.

Edits are locked when the version is published; corrections go through a new
version.

## Presentation (staging)

Independently of content edits, the **presentation** — camera framing, depth of
field, exposure/HDRI, reveal effects — is persisted per media and stays editable
**even after publication**. It is replayed identically for every spectator.

## Camera

The animated review camera (F-curve channels, dopesheet + graph editor) works the
same as in 3D review — see [Camera animation](camera-animation.md), including
depth-of-field keyframes.

## Performance

Splats use level-of-detail rendering; heavy scenes stay interactive during
navigation and editing.

## Related pages

- [Review 3D](review-3d.md)
- [Camera animation](camera-animation.md)
- [Upload & publishing](upload-and-publishing.md) — publish lock
