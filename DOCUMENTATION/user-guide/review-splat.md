# Gaussian splat review

> Updated: 2026-07-20

Gaussian splat media are rendered with **Spark (SparkJS)** inside the Three.js
scene, with the same DCC-style navigation as 3D review — plus a full
**non-destructive editor**.

## Supported formats

Splat files are served as-is (no server conversion) and loaded natively by Spark:

- **PLY** (text/binary, including compressed PLY)
- **SPZ** (compact gzip container — recommended for storage and fast loading)
- **SPLAT**, **KSPLAT**
- **SOG / SOGS** (PlayCanvas self-organizing gaussians, `.sog` zip bundle) —
  **read** support; a `.sogs` file is treated as a `.sog` bundle.

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

## Export

You can download the splat from the viewer's top-right HUD (the **download**
button — the viewer's right-click is reserved for navigation, so export lives in
the HUD, not a context menu). Two options:

- **Export cleaned splat (.spz)** — generates a compact SPZ file with the
  **edits baked in**: masked/deleted splats are dropped, crop volumes are applied,
  and the global transform is baked into each splat. The original file in storage
  is **never touched** (generation is fully client-side), so this also works after
  publication. Note: only base color is exported (SH degree 0 — view-dependent
  spherical harmonics are not included). The import orientation flip is *not*
  baked, so the file keeps the original axis convention.
- **Download original** — the raw uploaded file, unedited.

## Performance

Splats use level-of-detail (LOD) rendering; heavy scenes stay interactive during
navigation and editing. Large files stream in with a **real download progress
bar**, so heavy scenes open quickly and you can see loading progress.

## Related pages

- [Review 3D](review-3d.md)
- [Camera animation](camera-animation.md)
- [Upload & publishing](upload-and-publishing.md) — publish lock
