# Pipeline settings

> Updated: 2026-07-18

## Inherited delivery settings

Delivery settings cascade **studio → project → sequence → shot**. Each level
inherits from its parent unless overridden:

- **Resolution** (delivery width × height — drives the letterbox frame guide in
  review);
- **Framerate** (drives frame-accurate video review);
- **Frame ranges** (start/end frames per shot).

Colorspace is intentionally **not** configurable here. Video encoding is a
studio-level concern (see [Transcoding](transcoding.md)).

## Where to set them

- Studio defaults: *Admin → Réglages*.
- New-project defaults: *Admin → Défauts projet*.
- Project/sequence/shot overrides: on the entity's settings, for
  supervisors/admins.

## Effects in the app

- The review viewer letterboxes at the resolved delivery aspect; annotations are
  anchored to that frame.
- Frame stepping and timecode use the resolved framerate.
- Uploaded videos are transcoded once, studio-wide — the pipeline settings do not
  re-encode per level.

## Related pages

- [Projects & pipeline (user guide)](../user-guide/projects-and-pipeline.md)
- [Transcoding](transcoding.md)
