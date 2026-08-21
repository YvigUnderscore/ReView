# Colour management (OCIO)

> Updated: 2026-08-21

ReView manages colour intent with OpenColorIO (OCIO) configs. The official **ACES**
configs from the Academy Software Foundation are fetched directly from their GitHub
releases; projects then pick a display and a view.

> **Scope, stated up front.** This release covers **config management and
> display/view selection**. Pixel-exact OCIO transforms applied to the rendered image
> (via OCIO wasm or GPU LUTs) are a later step. Today the chosen display and view are
> recorded and shown as read-only badges; they do not change a single pixel. The only
> colour-affecting control in the viewer is the HDRI exposure in 3D. Do not tell a
> colourist that ReView is showing them an ACES view — it is showing them the label of
> one.

## Installing an ACES config

*Admin → Review contexts → Colour (OCIO)* (`/admin/ocio`):

1. Click **Browse ACES releases** — ReView lists the releases of
   [AcademySoftwareFoundation/OpenColorIO-Config-ACES](https://github.com/AcademySoftwareFoundation/OpenColorIO-Config-ACES/releases)
   and their config assets (studio / cg). Only the **15 most recent** releases are
   listed, and the result is cached for 10 minutes.
2. **Install** the config you want. The `.ocio` file is downloaded into studio storage
   at `studio/ocio/{uuid}.ocio` and the inventory is kept in a single setting row.
3. Use the **star** to set the studio default config.

The **studio config, ACES 1.3** is treated as the recommended default: on install it
is flagged as the studio default only if it is a studio ACES 1.3 asset *and* no
default exists yet. If no entry is flagged, the first installed config is used.

### Permissions

| Action | Route | Role |
|--------|-------|------|
| List installed configs (with a presigned URL) | `GET /api/studio/ocio/configs` | any authenticated account |
| List a config's displays and views | `GET /api/studio/ocio/configs/:id/displays` | any authenticated account |
| Browse ACES releases | `GET /api/studio/ocio/releases` | **`ADMIN`** |
| Install a config | `POST /api/studio/ocio/install` | **`ADMIN`** — audit `OCIO_INSTALL` |
| Set the studio default | `PUT /api/studio/ocio/configs/:id/default` | **`ADMIN`** — audit `OCIO_DEFAULT` |
| Delete a config | `DELETE /api/studio/ocio/configs/:id` | **`ADMIN`** — audit `OCIO_DELETE` |

Reading is open on purpose: every project settings screen and every viewer badge needs
the list.

### Supply-chain guards on the download

The install path fetches a file from the internet and stores it in studio storage, so
it is constrained deliberately:

- the **repository is hardcoded** — an administrator cannot point the installer at
  another GitHub project;
- the asset URL must be on one of **three allow-listed hosts**: `github.com`,
  `objects.githubusercontent.com`, `release-assets.githubusercontent.com`. Anything
  else is refused with `400 OCIO_BAD_HOST`;
- the asset is capped at **25 MiB**, checked both on the declared size and on the
  bytes actually received (`400 OCIO_TOO_LARGE`);
- the `.ocio` file is stored **verbatim and never executed**; ReView only line-scans it
  to extract display and view names.

Other errors you may see: `400 OCIO_RELEASES_FAILED` (GitHub refused or is
unreachable — often rate limiting on an unauthenticated API call),
`400 OCIO_ALREADY_INSTALLED`, `400 OCIO_DOWNLOAD_FAILED`.

Parsing bounds: at most **64 displays** and **64 views** per display; a display with no
views is dropped. Parsed results are cached in memory per config, which is safe
because an installed config is immutable.

## Per-project display / view

*Project → Settings → Colour management*: pick a config (or keep the studio default),
then a **display** and a **view** from that config. Saved through
`PUT /api/projects/:projectId/settings` (effective project role `SUPERVISOR` — a
project supervisor can set it). An empty config id means "use the studio default".

The choice appears as an `OCIO` badge in the 3D review dock, in the image viewer's
colour panel and in the media info sheet. In the image viewer, a project with no OCIO
setting shows the literal `sRGB` as its display — that is a placeholder label, not a
measured colour space.

### Deleting a config that projects use

Deletion removes the entry from the inventory and the object from storage. **It does
not cascade**: projects referencing it keep a dangling config id.

The visible result is a project whose display and view selectors come back empty and
disabled — the displays endpoint answers `404` — while the previously chosen display
and view strings keep showing in the badges, because they are stored as plain strings
and never re-resolved. Nothing breaks, nothing warns, and the project silently stops
being editable in colour terms.

Before deleting a config, check which projects reference it and move them to the
replacement first. If the deleted config was the studio default, the first remaining
config is promoted automatically.

---

## Use case: adopting ACES on a new show

1. *Admin → Colour (OCIO)* → **Browse ACES releases** → install the **studio config,
   ACES 1.3** unless the show has a reason to differ. Star it as the studio default so
   new projects inherit it.
2. On the show: *Project → Settings → Colour management*, leave the config on the
   studio default and pick the display that matches the review room's monitor and the
   view the show is graded for.
3. **Tell the team what this does and does not do.** The badge records the intent so
   that everyone agrees on the reference; the image in the viewer is unchanged. If a
   supervisor is judging a grade in ReView, they are judging the file as delivered,
   not an ACES-transformed version of it.
4. Keep the delivery convention outside ReView (in the DCC or the transcode) as the
   thing that actually determines pixels, and use the badge to make the intent
   discoverable.

## Use case: replacing an installed config

*A newer ACES release must supersede the one installed last year.*

1. Install the new config **first**. Both can coexist; there is no limit.
2. Move every project that references the old one to the new one, and re-select the
   display and the view — the strings are not migrated and would otherwise point at
   entries of a config that no longer exists.
3. Star the new config as the studio default.
4. Only then delete the old one. If you delete first, every project that used it loses
   the ability to change its selection until you re-point it, and the stale display
   and view keep showing as if nothing had happened.

## Related pages

- [Pipeline settings](pipeline-settings.md)
- [HDRI library](hdri-library.md)
- [3D review](../user-guide/review-3d.md)
