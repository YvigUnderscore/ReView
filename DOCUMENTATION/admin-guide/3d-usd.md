# USD & 3D conversion

> Updated: 2026-08-21

Uploaded 3D media are converted to **GLB** by the asset worker so the Three.js viewer can
display them. Routing by source format:

| Source | Converter | Notes |
|--------|-----------|-------|
| `.glb` | copy | served as-is |
| `.gltf` | JS packer | resolves `.bin` + relative textures, packs to GLB |
| `.usd` / `.usdc` / `.usda` | **Blender** (OpenUSD) | falls back to `guc`, then assimp |
| `.usdz` | **Blender** (OpenUSD) | opened directly — the package is never unzipped by ReView |
| `.zip` | archive → main model inside | USD archives resolve their **root layer**, see below |
| `.fbx` `.obj` `.dae` `.stl` | assimp | |

The converter that produced each GLB is recorded on the media and shown in the review
**technical sheet**, together with a USD section (root layer, up axis, unit scale,
animation range, variants, unresolved assets).

## Why Blender

Debian's `assimp` package has **no USD importer at all** (`assimp listext` lists no `usd*`
extension), so before this was in place every USD upload failed. Blender embeds a full
OpenUSD build and is currently the only single tool covering everything a review needs:

- composition — references, payloads, sublayers and variants are resolved, not ignored;
- `UsdPreviewSurface` materials translated to glTF PBR, textures repacked into the GLB;
- **animation**: `UsdSkel` skeletons and skinning, transform animation, cameras;
- up-axis (`upAxis`) and unit (`metersPerUnit`) conversion.

`guc` remains supported as a secondary converter (materials are excellent, but geometry is
static) and assimp as a last resort. The chain is **blender → guc → assimp**, each fallback
automatic, so enabling or removing a converter never breaks existing media.

## USD archives (`.zip` with assets)

A realistic USD delivery is a root layer plus payloads and textures in sub-folders. Two
things happen at ingest:

1. **Root layer detection.** ReView asks OpenUSD for each layer's dependency graph; the root
   is the layer no other layer references. Ties are broken by depth, then by a filename
   matching the archive, then by conventional names (`scene`, `root`, `main`, `asset`…).
   Without this, a binary payload (`.usdc`) could be opened instead of the ASCII root layer
   (`.usda`) and only part of the scene would show up.
2. **Unresolved asset report.** Textures or layers missing from the archive are listed in the
   technical sheet instead of silently producing an untextured model.

Archives are validated **before** any byte is written: entries escaping the target directory,
symbolic links, excessive entry counts, excessive uncompressed size and abnormal compression
ratios reject the whole archive with an explicit message.

An archive that behaves well looks like this — one obvious root layer, payloads and
textures below it:

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

The two mistakes that cost a re-delivery:

- **Absolute asset paths** (`/mnt/show/textures/brick.jpg`). The worker does not mount your
  storage, so those resolve to nothing and land in the *unresolved assets* list. Author
  relative paths, or flatten before packing.
- **Two candidate roots.** If `set.usda` and `set_lookdev.usda` both reference nobody, the
  tie is broken by depth, then by a name matching the archive, then by convention — which
  may not be the layer you meant. Ship one root per archive.

## Baked variants & the scene graph

Every option of every variant set is **baked into the converted GLB** as its own tagged
subtree, and every node carries the USD prim path it came from. Two consequences in review:

- the *Scene* panel shows the **real prim tree**, including prims that are not currently
  rendered, and a click in the viewer resolves to a prim;
- switching a variant is **instant** — the viewer just shows one subtree instead of another.
  No worker job, no reconversion, and therefore it also works on **published** media.

The cost is additive, not combinatorial: each option is composed with the other variant sets
left at their current value. Each bake pass is **masked to the bearing prim's subtree**
(`prim_path_mask`), so an option only costs its own geometry — a production scene with
hundreds of variant sets (Pixar's Kitchen_set: 200 sets, 366 options) bakes in a few minutes.
The overlay layers selecting each option are written in a single `usd-core` invocation (pure
Sdf, no composition).

Three limits keep pathological scenes in check:

| Variable | Default | Purpose |
|----------|---------|---------|
| `USD_MAX_BAKED_VARIANTS` | `512` | hard cap on options baked per media |
| `USD_VARIANT_VERTEX_BUDGET` | `8000000` | vertex count above which remaining options are skipped |
| *(time budget)* | half of `MODEL_CONVERT_TIMEOUT_MS` | baking stops before the conversion could time out |

Options that could not be baked are reported in the conversion summary
(`metadata.model.blender.variantsSkipped`) and shown **greyed out** in the review's variant
menus, with a hint to recompose. Media converted before baking existed keep their menus fully
enabled but switching has no effect — re-upload a version to get baked variants.

## ReView overrides

What reviewers change in the scene graph — visibility, transform, look, variant — is stored as
a **ReView override**: a small delta applied when the scene loads. It is not USD, and the
source file is never touched.

- The **media override** (`PUT /api/media/:id/usd/override`) is authored before publication by
  a manager and **frozen at publication**; it is replayed for every viewer.
- After publication, reviewers attach their changes to a **comment** instead. The proposal is
  replayed only when that comment is selected, so the shared scene never moves for everyone.

## Variants & purposes

If the scene exposes variant sets, reviewers who can manage the media see **Recompose the
scene…** in the technical sheet. Picking another variant or another purpose
(render / proxy / guide) re-runs the conversion.

The original file is never modified: the selection is authored into a small USD **overlay
layer** that sublayers the root, and that overlay is what gets converted. The requested
selection is stored on the media, so it survives job retries and later reprocessing.
Recomposing is refused on a **published** media (publication lock) — publish a new version
instead.

An integration that already knows the selection should not go through recomposition at all:
`POST /api/v1/publish` accepts the same `variants` and `purpose` under a `usd` field, and the
**first** conversion then runs with them. See
[API v1 — pipeline integration](../api/v1-integration.md#publishing-a-usd-scene-with-a-variant-selection).

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

Both entry points share one schema, so anything the recomposition accepts is accepted here
too. The bounds: at most **64 prims** in a selection, prim paths up to 1024 characters,
variant names up to 200. An unknown purpose (`"beauty"`) is rejected rather than ignored.

## Typical workflows

**Delivering an asset for look review.** Publish the `.usd` (or a `.zip` with its
payloads). The worker converts with `purpose: render` and bakes every variant. In the
review, the *Scene* panel shows the prim tree; the reviewer switches variants live and
leaves annotations on the frame they care about. Nothing is re-converted.

**Reviewing a heavy set in dailies.** Publish twice from the DCC — once with
`purpose: proxy` for the session that needs to stay responsive, once with
`purpose: render` for the look pass. Two versions, two files, no recomposition.

**A supervisor sets the scene before publication.** Before publishing, a manager can author
a **media override** (`PUT /api/media/:id/usd/override`): the variant, visibility and
transform everyone should open on. It is frozen at publication and replayed for every
viewer, so the whole team starts from the same shot. Afterwards, reviewers attach their
proposals to a comment instead, and those only play back when that comment is selected.

**A variant menu that is greyed out.** The option exceeded a baking budget, or the media
predates baking. The conversion summary
(`metadata.model.blender.variantsSkipped`) names the skipped options. Recompose with just
that selection, or re-upload a version.

## Enabling the USD toolchain

The toolchain is opt-in at build time and installed **only in the worker image** (the API
image is unchanged). `docker-compose.yml` already passes it for the `worker` service:

```bash
docker compose build worker && docker compose up -d worker
```

This installs, inside the worker image:

- **Blender 4.5.9 LTS** in `/opt/blender` — downloaded from `download.blender.org` with a
  pinned version and a verified SHA256;
- a **`usd-core` virtualenv** in `/opt/usdenv` — the OpenUSD Python runtime used for scene
  analysis (Blender does not expose the `pxr` module).

Measured cost: the worker image grows from **1.6 GB to 3.6 GB** (Blender 1.1 GB, the
`usd-core` virtualenv 234 MB, plus the X/GL runtime libraries Blender links against). To opt
out, build with `INSTALL_USD_TOOLS=` (empty): the image stays at its previous size, and USD
falls back to `guc`/assimp.

Verify it inside the running container:

```bash
docker compose exec worker /opt/blender/blender --version
```

### Settings

| Variable | Default | Purpose |
|----------|---------|---------|
| `USD_BLENDER_BIN` | `/opt/blender/blender` | Blender executable |
| `USD_PYTHON_BIN` | `/opt/usdenv/bin/python3` | Python with the `pxr` module |
| `USD_GLTF_CONVERTER` | *(empty)* | optional `guc`-style fallback (see below) |
| `MODEL_CONVERT_TIMEOUT_MS` | `900000` | max duration of any external converter |
| `ARCHIVE_MAX_ENTRIES` | `20000` | archive entry-count limit |
| `ARCHIVE_MAX_UNCOMPRESSED_BYTES` | `8589934592` | uncompressed size limit |
| `ARCHIVE_MAX_COMPRESSION_RATIO` | `200` | compression-ratio limit (decompression bombs) |

### Optional: `guc` fallback

Provide a self-contained [`guc`](https://github.com/pablode/guc) release at build time and
point the worker at it. It is only used when Blender is unavailable or fails:

```bash
docker compose build --build-arg GUC_URL="https://…/guc-linux-x86_64.tar.gz" worker
# .env
USD_GLTF_CONVERTER=guc
```

## Troubleshooting

A media that fails conversion now shows **why** in the review, and the same message is in
`docker compose logs worker`:

| Message | Cause |
|---------|-------|
| `Conversion assimp échouée … ENOENT` or no USD support | USD toolchain not installed — rebuild the worker image |
| `Archive refusée : …` | archive rejected by the safety checks (traversal, symlink, size, ratio) |
| `Aucun fichier 3D reconnu dans l'archive` | the zip contains no supported 3D file |
| `scene USD vide apres import` | the selected purpose has no geometry — recompose with `render` |
| `délai dépassé` | conversion exceeded `MODEL_CONVERT_TIMEOUT_MS` |

Unresolved assets do **not** fail the conversion: the model is shown and the missing
references are listed in the technical sheet.

Symptoms that are not failures:

| Symptom | Cause | What to do |
|---|---|---|
| The model shows up untextured | Textures were not in the archive, or their paths are absolute | Check *unresolved assets* in the technical sheet; re-pack with relative paths |
| Switching a variant does nothing | The media was converted before variant baking existed | Re-upload a version — baking happens at conversion time |
| A variant option is greyed out | It hit `USD_MAX_BAKED_VARIANTS`, the vertex budget, or the time budget | Recompose with that selection alone |
| The *Scene* panel carries no USD prim paths, and there is no USD section in the technical sheet | The converter used was `guc` or assimp, not Blender — only Blender resolves composition and tags prims | Confirm the converter in the technical sheet, then install the USD toolchain in the worker image |
| Geometry is there but nothing animates | `guc` produced it — its geometry is static by design | Same: make Blender the converter |

## Security notes

- Converter paths are **operator** settings (environment variables), never user-supplied.
  The worker only ever passes a downloaded source file and an output path, through
  `execFile` — no shell interpolation.
- Blender runs with `--factory-startup`: no user preference or add-on is loaded.
- Every conversion has a hard timeout, so a pathological scene cannot hold a worker slot.
- Archives are validated as a whole before extraction; one dangerous entry rejects the
  archive rather than extracting it partially.
- Variant selections coming from the API are filtered against the variant sets actually
  present in the scene.
- Sources are scanned by ClamAV (when enabled) before any converter runs.
