# USD & 3D conversion

> Updated: 2026-07-20

Uploaded 3D media are converted to **GLB** by the FFmpeg/asset worker so the Three.js
viewer can display them. Routing by source format:

| Source | Converter | Notes |
|--------|-----------|-------|
| `.glb` | copy | served as-is |
| `.gltf` | JS packer | resolves `.bin` + relative textures, packs to GLB |
| `.usd` / `.usdc` / `.usda` | **native USD→glTF** if enabled, else assimp | see below |
| `.usdz` | archive → same routing on the inner USD | textures unpacked alongside |
| `.fbx` `.obj` `.dae` `.stl` | assimp | |
| `.zip` | archive → highest-priority model inside | `gltf > glb > fbx > obj > … > usd` |

The converter that produced each GLB is recorded on the media and shown in the review
**technical sheet** (source format + converter, with a `natif` badge for native USD).

## Native USD converter (recommended for USD assets)

assimp's USD support is experimental: materials and **variants** are often lost. For
faithful USD (UsdPreviewSurface materials, variant selection preserved), enable a
dedicated USD→glTF converter such as [`guc`](https://github.com/pablode/guc). The worker
prefers it for USD formats and **falls back to assimp** automatically if it is absent or
fails — so enabling it is always safe.

### Enabling it

1. **Install the binary in the worker image.** Provide the URL of a self-contained `guc`
   release (Linux x86_64) at build time:

   ```bash
   docker compose build --build-arg GUC_URL="https://github.com/pablode/guc/releases/download/<version>/<asset>.tar.gz" worker
   ```

   Without `GUC_URL` the image is unchanged and USD keeps going through assimp.

2. **Activate it at runtime.** Point the worker at the installed binary:

   ```bash
   # .env (consumed by docker-compose)
   USD_GLTF_CONVERTER=guc
   ```

   `USD_GLTF_CONVERTER` is the converter command (on `PATH`, e.g. `guc`, or an absolute
   path). Empty (default) = assimp only. The worker invokes it as
   `USD_GLTF_CONVERTER <input.usd> <output.glb>`.

3. Restart the worker: `docker compose up -d worker`.

### Verifying

Upload a USD asset that uses UsdPreviewSurface materials and/or variants. In the review
technical sheet, *Conversion* should read **USD natif** with the `natif` badge, and the
materials/textures should match the DCC. If the converter is missing or errors, the
worker logs a warning (`convertisseur USD natif … échoué, repli assimp`) and the sheet
shows **assimp** instead.

## Security notes

- `USD_GLTF_CONVERTER` is an **admin/operator** setting (env var), never user-supplied.
  The worker only ever passes it the downloaded source file and an output path — no shell
  interpolation (`execFile`, not a shell).
- The converter binary is installed by the operator from a URL they control (`GUC_URL`),
  not fetched from user content.
