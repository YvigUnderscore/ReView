#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Render a thumbnail of a 3D model (GLB) via headless Blender.

Invoked by the spatial thumbnail worker:

    blender -b --factory-startup --python-exit-code 1 --python render_thumb.py -- \\
        --input model.glb --output thumb.png --size 512 --samples 24

Why Blender: it is already in the worker image (USD chain, 45.D) and reads the GLB that
the conversion already produces. The render is framed on the bounding box, lit by a
neutral dome, and output on a **transparent background**, so the tile takes the colour
of the theme.

Why Cycles CPU and not EEVEE: since Blender 4.2, EEVEE Next requires a GPU exposing
OpenGL 4.3. The worker's Docker image has none; an EEVEE render fails there or comes out
black. Cycles CPU is slower but gives the same image everywhere.

Output: a `REVIEW_THUMB_JSON {...}` line on stdout. The script never raises for an
empty or unreadable model: it reports it in the summary and exits with code 0, since a
missing thumbnail must not fail a job.
"""

import json
import math
import os
import sys

import bpy  # fourni par Blender
from mathutils import Vector  # fourni par Blender

MARKER = "REVIEW_THUMB_JSON"

# Three-quarter view: the same as the splat rasterizer, so that both families of
# media look alike in a list.
AZIMUTH_DEG = 35.0
ELEVATION_DEG = 22.0
# Margin around the subject: the bounding box is not the silhouette, so we do not frame tightly.
FRAMING_MARGIN = 1.18
GEOMETRY_TYPES = {"MESH", "CURVE", "SURFACE", "META", "FONT"}


def parse_args(argv):
    """Arguments located after the `--` of the Blender command line."""
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    import argparse

    parser = argparse.ArgumentParser(description="GLB -> vignette PNG (Blender)")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--size", type=int, default=512)
    parser.add_argument("--samples", type=int, default=24)
    return parser.parse_args(argv)


def emit(rendered, reason="", objects=0):
    payload = {
        "rendered": bool(rendered),
        "reason": reason,
        "objects": int(objects),
        "blender": bpy.app.version_string,
    }
    sys.stdout.write("\n%s %s\n" % (MARKER, json.dumps(payload)))
    sys.stdout.flush()


def import_glb(path):
    """Loads the GLB into an empty scene. Returns the failure pattern, or None."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        bpy.ops.import_scene.gltf(filepath=path)
    except Exception as exc:  # noqa: BLE001 - tout echec d'import se resume pareil
        return "import-failed:%s" % str(exc)[:200]
    return None


def world_bounds(objects):
    """World bounding box of the geometry, or None if it is degenerate."""
    lo = Vector((float("inf"),) * 3)
    hi = Vector((float("-inf"),) * 3)
    seen = False
    for obj in objects:
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                lo[axis] = min(lo[axis], point[axis])
                hi[axis] = max(hi[axis], point[axis])
            seen = True
    if not seen:
        return None
    size = hi - lo
    if not all(math.isfinite(v) for v in list(lo) + list(hi)):
        return None
    if max(size) <= 0:
        return None
    return lo, hi


def place_camera(scene, center, radius):
    """50 mm perspective camera framed on the bounding sphere, in three-quarter view."""
    data = bpy.data.cameras.new("ReviewThumbCam")
    data.lens = 50.0
    data.sensor_width = 36.0
    camera = bpy.data.objects.new("ReviewThumbCam", data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    azimuth = math.radians(AZIMUTH_DEG)
    elevation = math.radians(ELEVATION_DEG)
    # Blender is Z-up: -Y is the front of the scene.
    direction = Vector(
        (
            math.sin(azimuth) * math.cos(elevation),
            -math.cos(azimuth) * math.cos(elevation),
            math.sin(elevation),
        )
    )
    half_fov = math.atan((data.sensor_width / 2.0) / data.lens)
    distance = max(radius / math.sin(half_fov) * FRAMING_MARGIN, radius * 1.5, 1e-3)
    camera.location = center + direction * distance
    # The camera's local -Z axis looks at the scene, so we align local +Z with `direction`.
    camera.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    return camera


def light_scene(scene, center, radius):
    """Neutral dome (world background) plus one key light: readable without stylizing."""
    world = bpy.data.worlds.new("ReviewThumbWorld")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background is not None:
        background.inputs[0].default_value = (0.42, 0.43, 0.45, 1.0)
        background.inputs[1].default_value = 1.0
    scene.world = world

    data = bpy.data.lights.new("ReviewThumbKey", type="AREA")
    data.energy = max(radius, 0.1) ** 2 * 900.0
    data.size = max(radius, 0.1) * 2.0
    key = bpy.data.objects.new("ReviewThumbKey", data)
    scene.collection.objects.link(key)
    key.location = center + Vector((-radius * 2.0, -radius * 2.4, radius * 2.6))
    key.rotation_euler = (center - key.location).to_track_quat("-Z", "Y").to_euler()


def configure_render(scene, size, samples, output):
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    # Short bounces: a thumbnail does not need full inter-reflections, and each
    # bounce costs CPU time on a machine without a GPU.
    scene.cycles.max_bounces = 4
    try:
        scene.cycles.use_denoising = True
    except Exception:  # noqa: BLE001 - denoiseur absent d'une compilation : on rend brut
        pass
    # AgX (default in 4.x) washes out albedos: an asset thumbnail should look like its texture.
    try:
        scene.view_settings.view_transform = "Standard"
    except Exception:  # noqa: BLE001 - nom de transform inconnu de cette version
        pass

    scene.render.film_transparent = True
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.compression = 80
    # The worker imposes the exact file name: Blender must not add an extension to it.
    scene.render.use_file_extension = False
    scene.render.filepath = output


def main():
    args = parse_args(sys.argv)

    failure = import_glb(args.input)
    if failure is not None:
        emit(False, failure)
        return

    scene = bpy.context.scene
    geometry = [o for o in scene.objects if o.type in GEOMETRY_TYPES]
    if not geometry:
        emit(False, "no-geometry", 0)
        return

    bounds = world_bounds(geometry)
    if bounds is None:
        emit(False, "degenerate-bounds", len(geometry))
        return
    lo, hi = bounds
    center = (lo + hi) / 2.0
    radius = max((hi - lo).length / 2.0, 1e-4)

    place_camera(scene, center, radius)
    light_scene(scene, center, radius)
    configure_render(scene, max(32, args.size), max(1, args.samples), args.output)

    bpy.ops.render.render(write_still=True)

    if not os.path.exists(args.output) or os.path.getsize(args.output) == 0:
        emit(False, "empty-render", len(geometry))
        return
    emit(True, "", len(geometry))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Short message on stderr (no traceback): the worker logs it as is.
        print("%s: %s" % (type(error).__name__, error), file=sys.stderr)
        sys.stderr.flush()
        sys.exit(1)
