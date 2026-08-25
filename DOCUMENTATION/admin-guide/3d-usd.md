# USD & 3D conversion

*How USD, glTF and archives become the GLB the viewer shows, and how to put the Blender toolchain in the worker image.*

> Updated: 2026-08-23

The 3D viewer reads exactly one format: **GLB**. Everything a studio delivers — a USD stage
with its payloads, a glTF with a folder of textures, an FBX out of a DCC — is turned into a
GLB by the asset worker before anyone can review it. This page is about that step: which tool
handles which format, what it records, what it refuses, and what you have to install for USD
to work at all.

Nothing on this page changes the delivered file. Conversion writes a *derived* GLB next to the
original; the original is what your pipeline uploaded, and it stays byte-for-byte intact.

## What converts what

Routing is decided by the extension of the uploaded file, and nothing else.

| Source | Converter | What it means |
|--------|-----------|---------------|
| `.glb` | copy | Served as-is — no re-encoding, no quality loss, no delay |
| `.gltf` | JS packer | Resolves the `.bin` buffer and relative textures, packs everything into one GLB |
| `.usd` `.usdc` `.usda` | **Blender** (OpenUSD) | Falls back to `guc`, then to assimp |
| `.usdz` | **Blender** (OpenUSD) | Opened directly — the package is never unzipped by ReView |
| `.zip` | archive guard, then the model inside | A USD archive resolves its **root layer**, see below |
| `.fbx` `.obj` `.dae` `.stl` | assimp | Adjacent resources are resolved from the extracted folder |

![Five source families are routed to a converter — copy, JS packer, archive guard, Blender or assimp — and all of them produce one model.glb plus a technical sheet, after which a thumbnail job is queued; when Blender is absent or fails, USD falls back to guc and then to assimp.](../assets/admin-guide/usd-conversion-routing.svg)

### Why Blender, and what the fallbacks cost you

Debian's `assimp` package has **no USD importer at all** (`assimp listext` lists no `usd*`
extension), so before the toolchain existed every USD upload simply failed. Blender embeds a
full OpenUSD build and is currently the only single tool that covers everything a review
needs:

- **composition** — references, payloads, sublayers and variants are resolved, not ignored;
- **materials** — `UsdPreviewSurface` translated to glTF PBR, textures repacked into the GLB;
- **animation** — `UsdSkel` skeletons and skinning, transform animation, cameras;
- **units and orientation** — up axis (`upAxis`) and scale (`metersPerUnit`) conversion.

`guc` stays supported as a secondary converter — its materials are excellent, but its geometry
is static — and assimp as a last resort. The chain is **blender → guc → assimp**, each fallback
automatic, so enabling or removing a converter never breaks media that already exist. What you
lose going down the chain is visible in the review: no USD section in the technical sheet, no
prim paths in the *Scene* panel, and with `guc` nothing that animates.

> [!IMPORTANT]
> Every external converter runs under a hard timeout, `MODEL_CONVERT_TIMEOUT_MS`
> (**900 000 ms**, fifteen minutes). A pathological scene fails its job instead of holding a
> worker slot for the rest of the day.

### What a finished conversion leaves behind

The converter that produced each GLB is recorded on the media and shown in the review's
**technical sheet**, together with a USD section: root layer, up axis, unit scale, animation
range, variant sets, and the list of **unresolved assets**. That sheet is the first thing to
read when a model does not look like it did in the DCC — it says which tool was used, which
means it says what the tool could not do.

Once the GLB exists, a second job is queued on its own `spatial-thumb` queue and renders the
media's card image with Blender Cycles into `derived/<mediaId>/thumbnail.png`. It is decorative
by design: it never changes the media status, never overwrites a thumbnail chosen by hand, and
a failure there is a *successful* job with no image. See
[Spatial thumbnails](spatial-thumbnails.md).

## USD archives (a `.zip` and its assets)

A realistic USD delivery is a root layer plus payloads and textures in sub-folders. Two things
happen at ingest.

**Root layer detection.** ReView asks OpenUSD for each layer's dependency graph; the root is
the layer that no other layer in the archive references. Ties are broken in this order:

1. **depth** — a root lives at the top of the tree, not three folders down;
2. a **filename matching the archive** (`SH0100_set_v003.zip` → `SH0100_set_v003.usda`);
3. a **conventional name**: `scene`, `root`, `main`, `asset`, `world`, `shot`, `stage`;
4. alphabetical order, so the same archive always resolves the same way.

Without this, a binary payload (`.usdc`) would be opened instead of the ASCII root layer
(`.usda`) — the extension ranking puts `.usdc` first — and only part of the scene would show up.

**Unresolved asset report.** Textures or layers missing from the archive are listed in the
technical sheet rather than silently producing an untextured model. They do **not** fail the
conversion.

An archive that behaves looks like this — one obvious root, payloads and textures below it:

```
SH0100_set_v003.zip
├── set.usda              ← root: no other layer references it
├── payloads/
│   ├── building_a.usdc
│   └── props.usdc
└── textures/
    ├── brick_basecolor.jpg
    └── brick_normal.jpg
```

### What the archive guard refuses

The archive is judged **as a whole, from its catalogue, before a single byte is written**, and
one bad entry rejects the whole file. Extracting a USD scene partially would produce a
silently incomplete model, which is worse than an error.

| Refused | Why |
|---|---|
| An entry escaping the target directory (`../../etc/…`) | zip-slip — arbitrary write on the worker |
| An absolute path | Same, by another route |
| A symbolic link entry | Turns the next extraction into an arbitrary write |
| More than `ARCHIVE_MAX_ENTRIES` entries (**20 000**) | A real USD delivery stays in the low thousands |
| More than `ARCHIVE_MAX_UNCOMPRESSED_BYTES` (**8 GiB**) uncompressed | Volume budget |
| A global compression ratio above `ARCHIVE_MAX_COMPRESSION_RATIO` (**200**) | Decompression bomb |

Two more checks run per entry while reading, and are just as fatal: an entry whose **declared
size disagrees with what it actually contains**, and an entry using a **compression method
other than stored or DEFLATE**. Each entry is inflated with its declared size as a hard ceiling,
so a member that claims sixteen bytes and expands to gigabytes fails on that bound rather than
on the worker's memory.

> [!WARNING]
> The two mistakes that cost a re-delivery. **Absolute asset paths**
> (`/mnt/show/textures/brick.jpg`): the worker mounts none of your storage, so they resolve to
> nothing, land in *unresolved assets*, and the model shows up untextured while the conversion
> still reports success. **Two candidate roots**: if `set.usda` and `set_lookdev.usda` both
> reference nobody, the tie-break above picks one — and it may not be the layer you meant.
> Ship one root per archive, with relative paths.

## Baked variants and the scene graph

Every option of every variant set is **baked into the converted GLB** as its own tagged
subtree, and every node carries the USD prim path it came from. Two consequences in review:

- the *Scene* panel shows the **real prim tree**, including prims that are not currently
  rendered, and a click in the viewer resolves to a prim;
- switching a variant is **instant** — the viewer just shows one subtree instead of another.
  No worker job, no reconversion, and therefore it also works on **published** media.

The cost is additive, not combinatorial: each option is composed with the other variant sets
left at their current value. Each bake pass is **masked to the bearing prim's subtree**
(`prim_path_mask`), so an option only costs its own geometry — a production scene with hundreds
of variant sets (Pixar's Kitchen_set: 200 sets, 366 options) bakes in a few minutes. The
overlay layers selecting each option are written in a single `usd-core` invocation (pure `Sdf`,
no composition).

Three budgets keep pathological scenes in check:

| Variable | Default | Purpose |
|----------|---------|---------|
| `USD_MAX_BAKED_VARIANTS` | `512` | Hard cap on options baked per media |
| `USD_VARIANT_VERTEX_BUDGET` | `8000000` | Vertex count above which remaining options are skipped |
| *(time budget)* | half of `MODEL_CONVERT_TIMEOUT_MS` | Baking stops before the conversion itself could time out |

Options that could not be baked are reported in the conversion summary
(`metadata.model.blender.variantsSkipped`) and shown **greyed out** in the review's variant
menus, with a hint to recompose. Media converted before baking existed keep their menus fully
enabled but switching has no effect — re-upload a version to get baked variants.

## Choosing variants and purposes

If the scene exposes variant sets, reviewers who can manage the media see **Recompose the
scene…** in the technical sheet. Picking another variant, or another purpose
(render / proxy / guide), re-runs the conversion.

The original file is still never modified: the selection is authored into a small USD **overlay
layer** that sublayers the root, and that overlay is what gets converted. The requested
selection is stored on the media, so it survives job retries and later reprocessing.
Recomposing is **refused on a published media** (`403 PUBLISHED_LOCKED`) — publish a new version
instead.

An integration that already knows the selection should not go through recomposition at all.
`POST /api/v1/publish` accepts the same `variants` and `purpose` under a `usd` field, and the
**first** conversion then runs with them:

```jsonc
POST /api/v1/publish
{
  "path": "NEBULA/SQ010/SH0100/lookdev",
  "filename": "SH0100_set_v003.usd",
  "usd": {
    // One entry per bearing prim; inside it, one choice per variant set.
    "variants": { "/World/Set": { "modelingVariant": "hero", "lodVariant": "high" } },
    "purpose": "render"      // render | proxy | guide — default: render
  }
}
```

Both entry points share **one schema**, so anything the recomposition accepts is accepted here
too, and nothing is accepted at publication that would be refused later.

| Bound | Value |
|---|---|
| Prims in one selection | **64** maximum |
| Prim path length | 1024 characters |
| Variant set and variant names | 200 characters |
| `purpose` | `render`, `proxy` or `guide` — anything else is **rejected**, not ignored |

Whatever the caller sends is re-filtered server-side against the variant sets actually present
in the scene, so a stale selection degrades to the scene's defaults rather than failing.

> [!TIP]
> Heavy set in dailies? Publish twice from the DCC — once with `purpose: proxy` for the session
> that must stay responsive, once with `purpose: render` for the look pass. Two versions, two
> files, no recomposition, and both stay available.

## Four layers, and the only one a reviewer touches

What a reviewer sees is the delivered scene read through three layers written by ReView. Only
the top one is authored during review.

![From the bottom: the delivered USD source which is never modified, the USD overlay layer holding the variant and purpose selection, the converted GLB with every variant option baked as a tagged subtree, and on top the ReView override, which is either a media override written before publication or a proposal attached to a comment.](../assets/admin-guide/usd-layers-and-overrides.svg)

What reviewers change in the scene graph — visibility, transform, look, variant — is stored as
a **ReView override**: a small delta applied when the scene loads. It is not USD, and the source
file is never touched.

- The **media override** (`PUT /api/media/:id/usd/override`) is authored before publication by a
  manager and **frozen at publication**. It is replayed for every viewer, including guests on a
  share link, so the whole team opens the same shot on the same state.
- After publication, reviewers attach their changes to a **comment** instead. The proposal is
  replayed only while that comment is selected, so the shared scene never moves for everyone.

## Installing the USD toolchain

The toolchain is opt-in at build time and installed **only in the worker image** — the API image
is unchanged. `docker-compose.yml` already passes the build argument for the `worker` service:

```bash
docker compose build worker && docker compose up -d worker
```

That installs, inside the worker image:

- **Blender 4.5.9 LTS** in `/opt/blender`, downloaded from `download.blender.org` with a pinned
  version and a verified SHA256;
- a **`usd-core` virtualenv** in `/opt/usdenv` — the OpenUSD Python runtime used for scene
  analysis, layer graphs and overlay authoring (Blender does not expose the `pxr` module).

Measured cost: the worker image grows from **1.6 GB to 3.6 GB** (Blender 1.1 GB, the `usd-core`
virtualenv 234 MB, plus the X/GL runtime libraries Blender links against). To opt out, build
with `INSTALL_USD_TOOLS=` (empty): the image stays at its previous size, and USD falls back to
`guc`/assimp — which in practice means USD stops working properly.

Verify it inside the running container:

```bash
docker compose exec worker /opt/blender/blender --version
```

### Settings

| Variable | Default | Purpose |
|----------|---------|---------|
| `USD_BLENDER_BIN` | `/opt/blender/blender` | Blender executable |
| `USD_PYTHON_BIN` | `/opt/usdenv/bin/python3` | Python with the `pxr` module |
| `USD_GLTF_CONVERTER` | *(empty)* | Optional `guc`-style fallback, see below |
| `USD_MAX_BAKED_VARIANTS` | `512` | Options baked per media |
| `USD_VARIANT_VERTEX_BUDGET` | `8000000` | Vertex budget for baking |
| `MODEL_CONVERT_TIMEOUT_MS` | `900000` | Maximum duration of any external converter |
| `ARCHIVE_MAX_ENTRIES` | `20000` | Archive entry-count limit |
| `ARCHIVE_MAX_UNCOMPRESSED_BYTES` | `8589934592` | Uncompressed size limit |
| `ARCHIVE_MAX_COMPRESSION_RATIO` | `200` | Compression-ratio limit (decompression bombs) |

These are **operator** settings, read from the environment. None of them is reachable from the
admin interface, and none is ever taken from a request.

### Optional: the `guc` fallback

Provide a self-contained [`guc`](https://github.com/pablode/guc) release at build time and point
the worker at it. It is used only when Blender is unavailable or fails:

```bash
docker compose build --build-arg GUC_URL="https://…/guc-linux-x86_64.tar.gz" worker
# .env
USD_GLTF_CONVERTER=guc
```

## Troubleshooting

A media that fails conversion shows **why** in the review, and the same message is in
`docker compose logs worker`:

| Message | Cause |
|---------|-------|
| `Conversion assimp échouée … ENOENT`, or no USD support | USD toolchain not installed — rebuild the worker image |
| `Archive refusée : …` | Rejected by the archive guard (traversal, symlink, entry count, size, ratio, declared size, compression method) |
| `Aucun fichier 3D reconnu dans l'archive` | The zip contains no supported 3D file |
| `scene USD vide apres import` | The selected purpose has no geometry — recompose with `render` |
| `délai dépassé` | Conversion exceeded `MODEL_CONVERT_TIMEOUT_MS` |

And the symptoms that are **not** failures — the conversion succeeded, the result is not what
was expected:

| Symptom | Cause | What to do |
|---|---|---|
| The model shows up untextured | Textures were not in the archive, or their paths are absolute | Check *unresolved assets* in the technical sheet; re-pack with relative paths |
| Switching a variant does nothing | The media was converted before variant baking existed | Re-upload a version — baking happens at conversion time |
| A variant option is greyed out | It hit `USD_MAX_BAKED_VARIANTS`, the vertex budget, or the time budget | Recompose with that selection alone |
| The *Scene* panel carries no USD prim paths, and there is no USD section in the technical sheet | The converter used was `guc` or assimp, not Blender — only Blender resolves composition and tags prims | Confirm the converter in the technical sheet, then install the USD toolchain in the worker image |
| Geometry is there but nothing animates | `guc` produced it — its geometry is static by design | Same: make Blender the converter |
| Only part of the set is there | Another layer of the archive was opened as the root | Ship one root per archive; the technical sheet names the layer that was used |
| The card is empty although the model opens fine | The thumbnail job has not run, or Blender is missing from the worker image | See [Spatial thumbnails](spatial-thumbnails.md) — it never blocks the media |

## Security notes

- Converter paths are **operator** settings (environment variables), never user-supplied. The
  worker only ever passes a downloaded source file and an output path, through `execFile` — no
  shell interpolation.
- Blender runs with `--factory-startup`: no user preference and no add-on is loaded.
- Every conversion has a hard timeout, so a pathological scene cannot hold a worker slot.
- Archives are judged as a whole before extraction; one dangerous entry rejects the archive
  rather than extracting it partially.
- Variant selections coming from the API are filtered against the variant sets actually present
  in the scene.
- Sources are scanned by ClamAV, when enabled, before any converter runs.

## Related pages

- [Spatial thumbnails](spatial-thumbnails.md)
- [Alembic camera import](3d-alembic.md)
- [Reviewing 3D media](../user-guide/review-3d.md)
- [API v1 — pipeline integration](../api/v1-integration.md#publishing-a-usd-scene-with-a-variant-selection)
- [Jobs & workers](../infrastructure/jobs-and-workers.md)
- [System & maintenance](system-and-maintenance.md)
