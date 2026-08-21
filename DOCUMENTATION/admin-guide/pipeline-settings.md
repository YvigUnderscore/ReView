# Pipeline settings

> Updated: 2026-08-21

Pipeline settings describe **what the studio delivers**: frame size, framerate, shot
numbering, the ordered list of departments, and the naming rule applied to uploads.
They cascade **studio → project → sequence → shot**, each level overriding only the
fields it redefines.

Colorspace is deliberately **not** part of this cascade — colour intent is an OCIO
config chosen per project (see [Colour management](color-management.md)) and video
encoding is a studio-level concern (see [Transcoding](transcoding.md)).

## The three levels

| Level | Where | Who | Stored in |
|-------|-------|-----|-----------|
| Studio defaults | *Admin → Studio → Project defaults* (`/admin/defaults`) | `ADMIN` only (`GET`/`PUT /api/admin/project-defaults`) | `Setting.project_defaults` (JSON) |
| Project override | *Project → Settings* | effective project role `ADMIN`/`SUPERVISOR`, local elevation included (`PUT /api/projects/:projectId/settings`) | `Project.settings` (JSON) |
| Sequence / shot override | On the sequence or shot | global `ADMIN`/`SUPERVISOR` (`POST`/`PATCH /api/sequences`, `/api/shots`) | `Sequence.settings` / `Shot.settings` (JSON) |

Sequence and shot overrides accept **only** `resolution` and `framerate` (schema
`pipelineOverrideSchema`, `.strict()` — any other key is rejected). Frame ranges are
not part of that JSON: they live on dedicated columns, `Project.startFrame` and
`Shot.startFrame` / `Shot.endFrame`.

## Built-in defaults and accepted ranges

If `Setting.project_defaults` has never been written, the server falls back to:

| Setting | Built-in default | Accepted range |
|---------|------------------|----------------|
| Resolution | **1920 × 1080** | 1–16384 per axis, integers |
| Framerate | **24** | 1–240 |
| Sequence prefix | **`SQ`** | ≤ 16 characters |
| Shot prefix | **`SH`** | ≤ 16 characters |
| Numbering padding | **3** (→ `010`) | 1–8 |
| Numbering step | **10** (→ 010, 020, 030) | ≥ 1 |
| Upload naming rule | **empty pattern, mode `off`** | pattern ≤ 200 characters |
| Departments | Modeling, Rigging, Animation, FX, Lighting, Compositing, Look Dev, Layout | key ≤ 40, name ≤ 80 |
| Default start frame | **1001** (`Setting.default_start_frame`) | any integer |

Out-of-range values are **clamped, not rejected**, by the sanitiser; the Zod schema in
front of the route rejects them first, so an out-of-range value can only appear if it
was written to the database directly.

Note the built-in department order puts Layout last. That is almost never what a real
pipe looks like — reorder it before the first project, because the order is load
bearing (see below).

### Two write semantics that surprise people

- **`PUT /api/projects/:projectId/settings` replaces the whole project override.**
  The body becomes `Project.settings` verbatim. A partial PUT does not merge: any key
  you omit stops being a project override and falls back to the studio default. The
  settings screen always posts the full object; an API client must do the same.
- **A regex that could hang the server is refused at write time** with
  `400 NAMING_PATTERN_UNSAFE`. See [naming rule](#upload-naming-rule) below.

## Departments: the order *is* the pipe

The department list of a project is **ordered, upstream → downstream**
(Layout → Animation → FX → Lighting → Compositing). That order is not cosmetic: it
defines what the application calls *the latest version*.

- On an **asset** or a **shot**, the latest version is the one from the **furthest
  department reached that has something to show**, then the most recent within that
  department. A modeling fix published after lookdev does not send the asset backwards
  in the pipe.
- Every [auto cut timeline](../user-guide/auto-cut-timelines.md) picks a version per
  shot with the same rule.
- A task whose department is **unknown to the project** (rank `-1`) never wins the
  "furthest stage" contest against a known department, and is grouped **last** in
  display under a catch-all heading. A project with no departments configured at all
  therefore degrades gracefully: everything ranks equal and the most recent wins.

Departments are database entities (`Department`), scoped either to the studio
(`projectId = null`) or to one project. A project uses **its own departments if it has
any, otherwise the studio list**. There is no merge: creating a single project-level
department hides the whole studio list for that project.

Two ways to edit them, with different permissions:

- *Project → Settings → Departments* — goes through the project settings endpoint
  (`requireProjectManage`), so a **project supervisor can reorder the pipe**. The
  submitted list is synced into the `Department` table.
- `POST`/`PATCH`/`DELETE /api/departments…` and `PUT /api/departments/order` — require
  a **global** `ADMIN` or `SUPERVISOR`. Reading is open to any authenticated account,
  because department labels appear in badges and filters everywhere.

Departments carry an optional colour (`#RRGGBB`).

Tasks carry a department key: set explicitly at creation, deduced from the task name
for DCC publishes (`anim` → Animation). DCC publishes can address a department
explicitly with the `department:task` form —
`PROJ/SQ010/SH0100/layout:main/v001`. Without it the path keeps its historical meaning
(task only). See [API v1 integration](../api/v1-integration.md).

## Upload naming rule

*Project → Settings → Naming convention* enforces a **JavaScript regex** on uploaded
file names, with three modes:

| Mode | Behaviour | Default |
|------|-----------|---------|
| `off` | no check | ✔ |
| `warn` | non-matching names still upload; the uploader gets a warning | |
| `reject` | non-matching uploads are refused with `400 NAMING_REJECTED` | |

Security and safety properties, all verifiable in `lib/projectSettings.ts`:

- The pattern runs against **every** uploaded file name, on the API event loop. A
  pattern with a quantified group whose body itself contains a quantifier or an
  alternation (`(a+)+`, `(a|a)*`, `((a+))+`…) can block the whole API for the entire
  studio on one request. Such patterns are **refused when saved**
  (`400 NAMING_PATTERN_UNSAFE`) and, belt and braces, **neutralised at upload time**
  if one ever reached the database.
- An **invalid** regex, an empty pattern or mode `off` never blocks an upload: the
  check reports `pass: true, mode: 'off'`. The convention is a discipline aid, not a
  security control — never rely on it to keep a file shape out.
- The settings panel includes a live tester; use it before switching to `reject`.

## Default 3D lighting

A project can define a **default HDRI** for its 3D media in *Project → Settings*:
HDRI from the studio library (`hdriId`), `exposure` (0–10, default 1), `rotationDeg`
(−180 to 180, default 0), `showBackground` and `groundShadow` (both default `false`).

It is inherited studio → project and replayed when a 3D medium has no lighting of its
own; reviewers may still tweak it for their own session without changing the saved
default. See [3D review](../user-guide/review-3d.md#lighting--environment) and the
[HDRI library](hdri-library.md).

## Effects in the app

- The review viewer letterboxes at the **resolved delivery aspect**; annotations are
  anchored to that frame, so changing a shot's resolution changes where existing
  annotations sit relative to the guide.
- Frame stepping and timecode use the resolved framerate. The burn-in timecode is
  drawn at the media's probed fps, not at the pipeline framerate — a mismatch between
  the two shows up as a drifting burn-in.
- Uploaded videos are transcoded **once, studio-wide**. Pipeline settings do not
  re-encode anything per level.

---

## Use case: standing up the pipe for a new production

*A new show starts on Monday: 2.39:1 at 24 fps, six departments, shots numbered by 10.*

1. Decide whether this is the studio's new normal. If yes, edit *Admin → Studio →
   Project defaults* first — everything created afterwards inherits it, and you avoid
   repeating the work per project. If it is an exception, leave the studio defaults
   alone and override at project level.
2. *Admin → Project defaults* (or *Project → Settings*): set the delivery resolution
   and framerate. Remember the resolution here is the **delivery** frame; the viewer
   letterboxes to its aspect.
3. Set the nomenclature: prefixes, padding and step. Padding 3 with step 10 gives
   `SH010, SH020…`; padding 4 with step 10 gives `SH0010`. Changing this later does
   **not** renumber existing shots.
4. **Order the departments before anyone uploads.** The default list is not in pipe
   order. Delete what the show does not use, then arrange the rest upstream →
   downstream. Getting this wrong does not corrupt data, but every "latest version"
   in the app, and every auto cut timeline, will point at the wrong stage until it is
   fixed — and nobody will report it as a bug, they will just review the wrong file.
5. Set the default start frame (`Setting.default_start_frame`, 1001 out of the box) in
   *Admin → Settings* if the show uses another convention.
6. Only then create the structure: sequences and shots (global manager role required),
   or import them from CSV — see
   [Project organization](project-organization.md#csv-import--export).
7. Leave the naming convention on `warn` for the first week and read the warnings
   before switching to `reject`. Going straight to `reject` on day one turns every
   naming disagreement into a blocked upload at the worst possible moment.

## Use case: one sequence delivers at a different framerate

*Everything is 24 fps, but SQ090 is a 25 fps broadcast insert.*

Override at the **sequence** level rather than editing the project: set
`settings.framerate = 25` on SQ090. Shots inside it inherit 25 unless they override in
turn. The project stays at 24 for everything else, and the admin project detail page
shows an explicit `override` badge on SQ090 so the next person understands why the
timecode differs there (see
[Content explorer](content-explorer.md#projects--list-and-detail-page)).

What this does **not** do: it does not re-encode anything. Media already transcoded
keeps its own probed fps, which is what frame stepping and the burn-in timecode
actually use. The override changes the review frame reference, not the pixels.

## Use case: auditing what a shot really inherits

Open *Admin → Content → Projects → the project*. The hierarchy browser lists every
sequence and shot with its **effective** resolution and framerate after the full
studio → project → sequence → shot resolution, and tags each level `override` or
`inherited`. This is the fastest way to answer "why is this shot letterboxed
differently from its neighbour" without reading three JSON columns.

## Related pages

- [Projects & pipeline (user guide)](../user-guide/projects-and-pipeline.md)
- [Project organization & per-project rights](project-organization.md)
- [Transcoding](transcoding.md)
- [Content explorer](content-explorer.md)
