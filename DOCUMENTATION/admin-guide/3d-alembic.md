# Alembic camera import

> Updated: 2026-07-20

Alembic (`.abc`) is the standard camera-interchange format in VFX (Maya, Houdini, Nuke,
Blender). ReView can turn an Alembic **camera** into an editable v2 camera animation in the
review curve editor.

Alembic is a **binary** container (Ogawa); parsing it natively requires a compiled reader,
so ReView does not read `.abc` directly in the browser. Instead you extract the camera to a
small **JSON of samples** with an external tool (one-time, scriptable), then import that JSON
in the review — the same **Import** control that accepts glTF cameras.

## JSON sample schema

```jsonc
{
  "fps": 24,          // optional, to convert "frame" → seconds (default 24)
  "fovDeg": 45,       // optional default vertical FOV in degrees
  "samples": [
    // Either a look "target" OR a "quat" (xyzw) orientation. "t" (seconds) or "frame".
    { "frame": 0,  "pos": [0, 1.6, 5], "target": [0, 1, 0], "fov": 38 },
    { "frame": 24, "pos": [3, 1.6, 4], "target": [0, 1, 0], "fov": 38 }
  ]
}
```

- `pos` — camera world position `[x, y, z]` (required).
- `target` — look-at point `[x, y, z]`. If omitted, `quat` (xyzw) is used and the target is
  derived from the view direction (roll from the up vector).
- `fov` — per-sample vertical FOV in degrees (falls back to `fovDeg`, then `45`).
- `t` / `frame` — timing. `t` (seconds) wins; otherwise `frame / fps`; otherwise the sample
  index at `fps`.
- At least **2** usable samples are required. Dense samples are interpolated linearly.

## Extracting samples with Blender (headless)

Blender ships an Alembic importer and needs no extra libraries. Save as `abc_camera.py`:

```python
import bpy, json, sys

abc, out = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.alembic_import(filepath=abc)
cam = next(o for o in bpy.context.scene.objects if o.type == 'CAMERA')
scene = bpy.context.scene
fps = scene.render.fps

samples = []
for f in range(scene.frame_start, scene.frame_end + 1):
    scene.frame_set(f)
    m = cam.matrix_world
    pos = m.translation
    # -Z is the Blender camera forward; build a look target 1 unit ahead.
    fwd = (m.to_3x3() @ __import__('mathutils').Vector((0.0, 0.0, -1.0)))
    tgt = pos + fwd
    fov_deg = cam.data.angle_y * 180.0 / 3.141592653589793
    samples.append({
        "frame": f,
        "pos": [pos.x, pos.y, pos.z],
        "target": [tgt.x, tgt.y, tgt.z],
        "fov": fov_deg,
    })

json.dump({"fps": fps, "samples": samples}, open(out, "w"))
```

Run it:

```bash
blender --background --python abc_camera.py -- /path/shot_cam.abc /path/shot_cam.json
```

> **Axis note.** Blender is Z-up; if your target DCC/scene is Y-up, convert the coordinates
> in the script (swap/negate axes) so the imported camera lines up with the model.

## Importing in the review

1. Open a 3D or splat media, expand the **Animation** editor, click **Import**.
2. Choose the `.json` produced above. The camera keyframes load as a v2 animation (linear),
   ready to scrub, edit in the curve editor, or **save as presentation** (replayed for
   everyone). glTF/GLB camera files still import through the same button.

## Native `.abc` worker (future / optional)

A containerized worker that reads Ogawa directly (e.g. PyAlembic or a Blender step baked into
the asset worker) can remove the manual extraction. This follows the same opt-in pattern as
the [native USD converter](3d-usd.md): a binary installed in the worker image behind an env
flag, with the JSON schema above as the internal exchange contract.

## Security notes

- The importer only reads the JSON on the client; it performs `JSON.parse` and validates the
  shape, ignoring unknown fields. Malformed files are rejected with a toast, never executed.
- No `.abc` bytes are parsed in the browser, so there is no native-parser attack surface.
