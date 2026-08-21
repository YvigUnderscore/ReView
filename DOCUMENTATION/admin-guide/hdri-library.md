# HDRI library

> Updated: 2026-08-21

*Admin → Review contexts → 3D & Splat* (`/admin/hdri`) manages the studio's **HDRI
environment library**, used to light 3D reviews.

## Managing environments

Uploading is a two-step, `ADMIN`-only flow:

1. `POST /api/studio/hdris/presign` returns a presigned PUT for
   `studio/hdris/{uuid}.{hdr|exr}`;
2. the browser uploads straight to MinIO;
3. `POST /api/studio/hdris` registers the entry (name, storage key, format) — audit
   `HDRI_ADD`.

`GET /api/studio/hdris` is open to any authenticated account: the 3D viewer needs the
list. Deleting is `DELETE /api/studio/hdris/:id` (`ADMIN`, audit `HDRI_DELETE`).

Constraints, precisely:

- **Only `hdr` and `exr`** are accepted; anything else is refused with
  `400 BAD_FORMAT`. The **extension check is client-side only** — the server trusts
  the declared format and verifies that the storage key starts with `studio/hdris/`
  (`400 BAD_KEY` otherwise).
- **There is no size limit.** The studio-wide `max_file_size` applies to media
  uploads, not to the HDRI library. A 4 GB EXR latlong will upload, will be stored,
  and will then be downloaded in full by every browser that opens a 3D review using
  it. Curate the library deliberately: resize environments before uploading.
- The preview thumbnail is **tone-mapped in the browser** (96 × 48, on the main
  thread) and is never stored. A large file therefore makes the admin page itself slow
  to render, which is the earliest symptom of an over-sized library.

## How reviewers use it

In a **3D model** review (not splat — a splat carries its baked lighting), the dock's
lighting panel offers the HDRI list, an exposure, a Y rotation, a background toggle
and a ground-shadow toggle.

**Who can save the choice matters**, and it is narrower than "reviewers":

- Anyone can tweak the lighting **for their own session**. Those changes are lost on
  reload and are not shared.
- Only an `ADMIN`, a `SUPERVISOR`, or **the person who uploaded the media** can
  persist it. The saved configuration is stored per media, in
  `metadata.splatPresentation.lighting`, and is replayed for every subsequent viewer —
  so everyone judges the model under the same light.
- Saving is allowed even on a **published** media: lighting is staging, not content.
  It is one of the two documented exceptions to the publication lock.

Server-side bounds on the saved lighting: exposure **0–10**, rotation **−360 to 360**,
`showBackground` required, `groundShadow` optional. Note the viewer's exposure control
allows negative values, which the API rejects — a negative exposure cannot be saved.

## Project default lighting

A project can define the lighting replayed when a 3D medium has none of its own,
in *Project → Settings* (effective project role `SUPERVISOR`):

| Field | Default | Range |
|-------|---------|-------|
| `hdriId` | none | ≤ 64 characters |
| `exposure` | 1 | 0–10 |
| `rotationDeg` | 0 | −180 to 180 |
| `showBackground` | `false` | boolean |
| `groundShadow` | `false` | boolean |

Resolution order when a 3D media opens: the media's own saved lighting → the project
default → a neutral built-in (exposure 1, no rotation, no background, no ground
shadow). See
[Pipeline settings](pipeline-settings.md#default-3d-lighting).

## Deleting an HDRI that media reference

Deletion removes the library entry and the storage object. **It does not cascade** —
media and project settings keep the now-dangling `hdriId`.

What the viewer actually does is worth stating plainly, because the intuitive
expectation is wrong: it does **not** fall back to another HDRI. The environment map
is dropped entirely (`scene.environment = null`, no background) and the scene reverts
to its **neutral built-in light rig at full intensity** — which is brighter and flatter
than an HDRI-lit scene, because the default lights are attenuated while an environment
is active. The saved exposure, rotation, background and ground-shadow values are kept
and applied to that rig.

The practical consequence: deleting a popular HDRI silently changes the look of every
model reviewed under it, including published ones, with no warning and no audit trail
on the affected media. Rename or replace rather than delete when a review is in
flight.

---

## Use case: setting up a lighting reference for a look-dev review

*Look-dev wants every asset judged under the same two environments.*

1. Upload the two environments (`.hdr` or `.exr`), resized to something a browser can
   fetch quickly — 2K latlong is plenty for review, and there is no size limit to stop
   you from uploading a 16K one by mistake.
2. Set the **project default lighting** on the show: the chosen HDRI, an agreed
   exposure and rotation, background off (so the asset is judged, not the backdrop),
   ground shadow on if the department wants contact.
3. From then on every 3D media of the project opens under that light without anyone
   touching a control.
4. When an asset needs its own setup, have the supervisor or the uploader save it on
   that media — it then overrides the project default for every viewer.
5. Tell artists that their own tweaks are session-only. The recurring complaint "my
   lighting reset itself" is this rule, not a bug.

## Use case: pruning the library without breaking reviews

1. `GET /api/studio/hdris` gives the ids. There is no built-in "where is this used"
   report, so treat every deletion as potentially breaking.
2. Prefer **replacing the file behind a name** conceptually: upload the new
   environment, re-point the project defaults and the per-media configurations to it,
   and only then delete the old entry.
3. If you must delete something in use, do it between shows, not during a review
   round — the change is immediate, retroactive and silent.
4. Never delete an environment referenced by a **published** media's saved lighting
   without telling the supervisor: the media stays published and locked, but it will
   no longer look the way it was approved.

## Related pages

- [Pipeline settings](pipeline-settings.md#default-3d-lighting)
- [Colour management](color-management.md)
- [3D review (user guide)](../user-guide/review-3d.md)
