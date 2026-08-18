# Pipeline settings

> Updated: 2026-07-19

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

- Studio defaults: *Admin → Settings*.
- New-project defaults: *Admin → Project defaults*.
- Project/sequence/shot overrides: on the entity's settings, for
  supervisors/admins.

## Departments: the order is the pipe

The department list of a project is **ordered**, from upstream to downstream
(Layout → Animation → FX → Lighting → Compositing). That order is not cosmetic:
it defines what the application calls *the latest version*.

- On an **asset** or a **shot**, the latest version is the one of the furthest
  department reached that has published media — not simply the most recent
  upload. A modeling fix published after lookdev does not send the asset
  backwards in the pipe.
- Every [auto cut timeline](../user-guide/auto-cut-timelines.md) uses the same
  rule to pick a version per shot.

Reorder departments with the arrows in *Project → Settings → Departments* (or
*Admin → Project defaults* for new projects). Tasks carry a department key: it is
set explicitly on creation, deduced from the task name for DCC publishes
(`anim` → Animation), and tasks whose department is unknown to the project are
grouped last and never win the "furthest stage" contest.

DCC publishes can address a department explicitly in the pipeline path, with the
`department:task` form — `PROJ/SQ010/SH0100/layout:main/v001`. Without it the
path keeps its historical meaning (task only). See
[API v1 integration](../api/v1-integration.md).

## Default 3D lighting

A project can define a **default HDRI** for its 3D media in *Project → Settings →
Éclairage 3D par défaut*: HDRI from the studio library, exposure, Y rotation,
background and ground shadow. It is inherited studio → project and replayed when a
3D medium has no lighting of its own; reviewers may still tweak it per session
without changing the saved default. See
[3D review](../user-guide/review-3d.md#lighting--environment).

## Effects in the app

- The review viewer letterboxes at the resolved delivery aspect; annotations are
  anchored to that frame.
- Frame stepping and timecode use the resolved framerate.
- Uploaded videos are transcoded once, studio-wide — the pipeline settings do not
  re-encode per level.

## Related pages

- [Projects & pipeline (user guide)](../user-guide/projects-and-pipeline.md)
- [Transcoding](transcoding.md)
