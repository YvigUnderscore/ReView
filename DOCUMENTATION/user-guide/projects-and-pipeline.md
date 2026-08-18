# Projects & pipeline

> Updated: 2026-07-18

## Hierarchy

```
Project
├── Sequence → Shot → Task → Version → Media
└── Asset            → Task → Version → Media
```

- **Projects** hold everything and carry a status (`ACTIVE`, `ON_HOLD`, `COMPLETED`,
  `ARCHIVED`).
- **Sequences** group **shots** (shot-based work); **assets**
  (character/prop/environment/vehicle/FX/other) live directly under the project
  (asset-based work).
- **Tasks** are typed pipeline steps (modeling, rigging, animation, FX, lighting,
  compositing, lookdev, layout…) attached to a shot or an asset, with a kanban
  status (`TODO`, `IN_PROGRESS`, `PENDING_REVIEW`, `APPROVED`, `REJECTED`, `RETAKE`).
- **Versions** (V01, V02…) belong to a task (or directly to an asset) and hold the
  actual **media** to review: video, image, 3D model, or Gaussian splat.

## Inherited pipeline settings

Delivery settings — **resolution, framerate and frame ranges** — cascade down the
hierarchy: **studio → project → sequence → shot**. Each level either inherits from
its parent or overrides a value; the review viewer uses the resolved values (e.g.
letterbox frame guide at the delivery aspect ratio). Colorspace is deliberately
**not** part of these settings; video transcoding is configured studio-wide by
administrators only (see [Transcoding](../admin-guide/transcoding.md)).

## Versions & publication

A version starts as a **draft** (`DRAFT`): only its author and supervisors see it in
the "review before publish" flow. Publishing (`PUBLISHED`) makes it visible to the
project and **permanently locks its content**:

- locked after publish: splat edits & masks, video trim, reprocessing, 3D transform;
- still editable: splat *presentation* (staging: camera framing, DoF…) and the
  thumbnail;
- there is **no unpublish** — corrections are delivered as a **new version**.

## Project page

The project page groups sequences, shots, assets, media and team members, with
tabs and filters. Right-click cards for contextual actions; use multi-select for
bulk operations (see [Navigation & search](navigation-and-search.md)).

Tabs follow the pipe, from the whole to the detail: overview, sequences, shots,
assets. The **Shots** and **Assets** lists carry a search box and filters — status,
sequence, department, type — and saved presets, shared with the kanban.

## Sequence page

A sequence opens on its own page (`/sequences/:id`): its **cut** first, kept up to
date at every publish, then its shots as a grid with thumbnail, status and task
count. The whole-film cut sits at the top of the **Sequences** tab.

Right-click a sequence — in the tab or on its page — to open it, reach its settings
or add its latest published versions to a playlist.

## Entity settings

Sequences, shots and assets share one settings panel, opened by right-click or by
the gear in the page header (managers only):

- **name, code and description**;
- **thumbnail** — PNG, JPEG or WebP; without one, the first published media is used;
- **status**, taken from the project's own vocabulary;
- **departments** the entity goes through;
- **frame range** (shots) and **type name** (assets);
- **resolution and rate overrides**, inherited studio → project → sequence → shot.

## Related pages

- [Upload & publishing](upload-and-publishing.md)
- [Kanban & tasks](kanban-and-tasks.md)
- [Pipeline settings (admin)](../admin-guide/pipeline-settings.md)
