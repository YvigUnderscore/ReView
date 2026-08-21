# Gaussian splat review

> Updated: 2026-08-21

> All four media types share the same workspace — mode switch, tool rail, options bar,
> inspector dock, bottom row. See **[The review workspace](review-workspace.md)** for the
> layout, the modes and the keyboard map; this page covers what is specific to Gaussian
> splats.

Gaussian splat media are rendered with **Spark (SparkJS)** inside the Three.js scene, with
the same DCC-style navigation as 3D review — plus a full **non-destructive editor**.

The mode switch offers **Explore** (`1`), **Staging** (`2`) and **Clean up** (`3`); the
Annotate mode is armed from the comment composer or a tool letter.

## Supported formats

Splat files are served as-is — there is no server-side conversion — and loaded natively by
Spark:

- **PLY** (text or binary, including compressed PLY)
- **SPZ** (compact gzip container — the best choice for storage and load time)
- **SPLAT**, **KSPLAT**
- **SOG / SOGS** (PlayCanvas self-organizing gaussians, a `.sog` zip bundle) — **read**
  support only; a `.sogs` file is handled as a `.sog` bundle.

## Navigation

Orbit by dragging, zoom with the wheel, pan with the middle button. **Hold the right mouse
button** for free flight: the mouse looks around, `W`/`A`/`S`/`D` move (physical key
positions, so `Z`/`Q`/`S`/`D` on an AZERTY keyboard), `E` goes up and `Q` down, the wheel
sets the flight speed and `Shift` multiplies it by five. Releasing the button hands the
orbit back with the target placed in front of the camera.

`F` fits the selection — or the whole cloud when nothing is selected — and `H` returns to
the home view.

## Non-destructive editing

The original splat file is **never modified**. Every edit is stored as metadata — a
selection mask bitset plus an edit list — and **replayed identically for every viewer**.
All of it lives in the **Clean up** mode.

**Selecting** (`B` rectangle, `L` lasso, `P` surface brush). The three tools share the same
modifiers: **`Shift` adds** to the selection, **`Alt` removes** from it, and a plain drag
replaces it. The surface brush only takes splats on the visible surface, which is what makes
it usable on a scan where a rectangle would swallow everything behind. Its radius is in the
options bar.

**Deleting** — `Delete` or `Backspace` hides the selection. Nothing is destroyed: the
splats are masked, and clearing the mask brings them back. This is how floaters and
background get removed.

**Cutting volumes** (`O`) — drop a **box** or a **sphere** and choose what it does: *carve*
removes what is inside, *isolate* keeps only what is inside. Volumes can be moved with the
gizmo like anything else.

**Transforming** — `T` move, `R` rotate, `S` scale. With nothing selected the gizmo
transforms the whole cloud; with a selection active it transforms just that subset.

**Correcting the orientation** — the *Corrected orientation* switch in the *Display* panel
flips the Y-down convention some exporters use.

`Ctrl/⌘+Z`, `Ctrl/⌘+Y` and `Ctrl/⌘+Shift+Z` walk the edit history. None of the keyboard
shortcuts fire while you are flying, typing, or inside a dialog.

Edits are **locked once the version is published**; corrections go through a new version.

## Annotating a splat

The **Annotate** mode carries its own tools rather than 2D drawing:

- **3D brush** (`P`) paints a stroke on the surface of the cloud. The stroke is stored in
  object space and travels with the comment — it is an annotation, not an edit, and it never
  touches the splat data.
- **Pin** (`I`) anchors the comment to a point on the surface, so opening the comment brings
  everyone back to it.

## Display & inspection

The *Display* panel of the dock switches the cloud between **Splats**, **Ellipses** and
**Points**, and offers a session-local **inspection colouring** (normals or depth). None of
it is saved on the media.

The **Focus** tool (`C`, splat only) sets the depth-of-field distance on the point you
click; the aperture itself is a field of the *Camera* panel, where `0` means sharp
everywhere.

## Presentation (staging)

Independently of the content edits, the **presentation** — camera framing and animation,
depth of field, reveal effect, default level of detail — is persisted per media
and stays editable **even after publication**. It is replayed identically for every
spectator. See [Camera animation](camera-animation.md).

*Clear the presentation* in the *Camera* panel removes all of it at once; the file, the mask
and the edits are untouched.

## Performance

- Large files stream in with a **real download progress bar** and a percentage, so a heavy
  scene shows progress instead of a frozen screen.
- **Level of detail** has four settings in the *Scene* panel: off, on, **auto** and
  streaming (pages fetched on demand). *Auto* is the default: it engages when the framerate
  stays under 15 fps for five seconds and releases when it recovers above 25 fps for five
  seconds, each time with a toast so the change in image quality is never a mystery. The
  default is persisted per media.

## Export

Both exports live in the **Export** panel of the dock — the viewer's right-click is reserved
for flight, so nothing splat-related hides in a context menu.

- **Export cleaned splat (.spz)** generates a compact SPZ with the **edits baked in**:
  masked splats are dropped, cutting volumes are applied, and the global transform is baked
  into each splat. Generation is entirely client-side and the file in storage is never
  touched, so this works after publication too. Two limits to know: only base colour is
  exported (SH degree 0 — view-dependent spherical harmonics are not included), and the
  import orientation flip is *not* baked, so the file keeps the original axis convention.
- **Download original** gives the raw uploaded file, unedited.

The export uses the **saved** edits, not your current unsaved selection — save from the
commit group first.

## Use cases

### Cleaning a set scan before it goes to layout

The scan arrives with a halo of floaters and half a car park behind the wall. Press `3` for
Clean up, arm the surface brush with `P`, and sweep over the floaters — the brush only takes
what is actually visible, so the wall behind survives. `Delete` hides them. For the car park,
drop a box volume with `O`, set it to *isolate*, and scale it around the set: everything
outside disappears. Save from the commit group and every reviewer opens the cleaned scan —
the uploaded file is still intact if you got the box wrong.

### A note on a detail nobody else can find

In a point cloud, "the crack near the door" is meaningless. Arm the **Pin** (`I`) in
Annotate mode, click the crack, write the note. Anyone selecting that comment lands on the
point. If the note is about an area rather than a point, use the 3D brush to paint over it —
the stroke sticks to the surface and reads from any angle.

### Delivering a clean SPZ to another department

Once the mask and the volumes are saved, take *Export cleaned splat (.spz)* from the Export
panel. The masked splats are gone from the file rather than hidden, the transform is baked,
and the result is a fraction of the original size. Note the two caveats: base colour only,
and the original axis convention.

### A scan that crawls on a laptop

Leave the level of detail on *auto*. When the reviewer's machine drops below 15 fps, LOD
engages by itself and a toast says why the image just got softer; when the framerate
recovers it releases. If a particular scene is always heavy, set the level of detail
explicitly in the *Scene* panel and save the presentation — the setting travels with the
media.

## Troubleshooting

**"Splat cannot be displayed: the file could not be loaded."** The format is not one of
`.ply`, `.spz`, `.splat`, `.ksplat`, `.sog`, or the file is corrupt. Re-upload — nothing is
converted server-side, so what you upload is what the viewer has to read.

**Editing tools are missing from the Clean up mode.** Splat editing requires that you can
manage the media *and* that it is not published. After publication the backend refuses every
edit with a 403.

**"Nothing to export (everything is masked or cropped)".** The saved mask and volumes leave
no splat standing. Check the volume modes: an *isolate* volume placed outside the geometry
keeps nothing.

**My last selection is not in the exported file.** Exports use the saved edits. Save from
the commit group in the options bar, then export.

**Keyboard shortcuts do nothing.** They are inert while you hold the right mouse button
(flight), while the caret is in a field, and while a dialog is open.

**The camera presentation saved, but the mask did not.** They are two different endpoints
with two different rules: presentation stays editable after publication, content edits do
not. If the media is published, only the presentation will save.

## Related pages

- [The review workspace](review-workspace.md)
- [3D review](review-3d.md)
- [Camera animation](camera-animation.md)
- [Annotations & comments](annotations-and-comments.md)
- [Upload & publishing](upload-and-publishing.md) — the publish lock
