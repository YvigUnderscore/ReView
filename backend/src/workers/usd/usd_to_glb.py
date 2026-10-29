#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""USD -> GLB conversion via headless Blender (Phase 45, 45.C).

Invoked by the worker:

    blender -b --factory-startup --python usd_to_glb.py -- \\
        --input scene.usda --output model.glb [--purpose render] \\
        [--frame-start 1 --frame-end 96 --fps 24]

Why Blender: it embeds the full OpenUSD. It therefore composes references, payloads,
sublayers and variants, translates UsdPreviewSurface into PBR materials, imports UsdSkel
(skeletons and animation) and cameras, then re-exports everything as binary glTF: the
only format read by the review's Three.js viewer.

The original file is never modified: Blender reads, exports elsewhere, and the worker
only pushes the derived GLB.

Output: a `REVIEW_USD_JSON {...}` line on stdout (Blender is very chatty; the marker
lets the worker find the summary without ambiguity).
"""

import json
import os
import re
import sys

import bpy  # fourni par Blender

MARKER = "REVIEW_USD_JSON"
# USD purposes: what is rendered (render), the fast display proxy (proxy), and the
# staging aids (guide, never desirable in review).
PURPOSES = ("render", "proxy", "guide")


def parse_args(argv):
    """Arguments located after the `--` of the Blender command line."""
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    import argparse

    parser = argparse.ArgumentParser(description="USD -> GLB (Blender)")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--purpose", choices=PURPOSES, default="render")
    parser.add_argument("--frame-start", type=float)
    parser.add_argument("--frame-end", type=float)
    parser.add_argument("--fps", type=float)
    parser.add_argument("--no-animation", action="store_true")
    parser.add_argument("--variant-layers", help="manifeste JSON des options de variantes a cuire")
    parser.add_argument("--variant-vertex-budget", type=int, default=8_000_000)
    # TIME budget for baking in seconds (0 = unlimited): on a scene with many
    # variants, it is better to deliver a GLB with some of the options baked than to
    # let the worker's timeout expire and lose the whole conversion.
    parser.add_argument("--variant-time-budget", type=float, default=0)
    return parser.parse_args(argv)


def supported(operator, wanted):
    """Keeps only the options actually exposed by this version of Blender.

    The option names of `wm.usd_import` and `export_scene.gltf` shift from one version to
    the next; filtering on the RNA prevents a version upgrade from breaking the conversion.
    """
    try:
        available = set(operator.get_rna_type().properties.keys())
    except Exception:
        return dict(wanted)
    return {key: value for key, value in wanted.items() if key in available}


def ensure_gltf_exporter():
    if hasattr(bpy.ops.export_scene, "gltf"):
        return
    import addon_utils

    addon_utils.enable("io_scene_gltf2", default_set=False, persistent=True)
    if not hasattr(bpy.ops.export_scene, "gltf"):
        raise RuntimeError("exporteur glTF indisponible dans cette installation Blender")


def reset_scene():
    """Empty scene: without this, the default cube, camera and lamp end up in the GLB."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_usd(path, purpose):
    options = {
        "filepath": path,
        "set_frame_range": True,
        "import_cameras": True,
        "import_lights": True,
        "import_materials": True,
        "import_meshes": True,
        "import_curves": True,
        "import_shapes": True,
        "import_skeletons": True,
        "import_blendshapes": True,
        "import_subdiv": True,
        "import_volumes": False,
        "support_scene_instancing": True,
        "import_visible_only": True,
        "read_mesh_uvs": True,
        "read_mesh_colors": True,
        "apply_unit_conversion_scale": True,
        "import_render": purpose == "render",
        "import_proxy": purpose == "proxy",
        "import_guide": purpose == "guide",
    }
    result = bpy.ops.wm.usd_import(**supported(bpy.ops.wm.usd_import, options))
    if "FINISHED" not in result:
        raise RuntimeError("import USD refuse par Blender (%s)" % ", ".join(result))


def tag_usd_paths():
    """Writes onto each object the path of the USD prim it comes from (Phase 46, 46.A).

    Blender's USD importer does not expose this path, but it **faithfully reproduces the
    hierarchy** of prims in that of the objects: `World > Asset > Geo > Suzanne` comes from
    `/World/Asset/Geo/Suzanne`. We therefore walk it up parent by parent.

    Blender disambiguates colliding names with a `.001` suffix: it must be stripped,
    otherwise the rebuilt path would match no prim. This is done right after the import,
    before any other manipulation of the scene.

    The path then goes into the `extras` of the glTF node (`export_extras`), which gives the
    viewer the rendered node -> USD prim match: without it, neither the scenegraph nor the
    per-prim override is possible.
    """
    tagged = 0
    for obj in bpy.data.objects:
        obj["usdPath"] = usd_path_of(obj)
        tagged += 1
    return tagged


def usd_path_of(obj):
    """Prim path of an object, rebuilt from its lineage (.NNN suffixes removed)."""
    names = []
    node = obj
    while node is not None:
        names.append(re.sub(r"\.\d{3}$", "", node.name))
        node = node.parent
    return "/" + "/".join(reversed(names))


def tag_variant_membership(objects, prim, selections):
    """Mark the objects of a subtree as belonging to variant options.

    `selections` is a dict set -> option, merged with the existing one: a prim can carry
    **several** sets (Kitchen_set: the plates have modelingVariant AND shadingVariant).
    The old single-key marking was overwritten from one set to the other: changing one set
    left the base geometry visible next to the baked option, hence duplicates on screen (46.R).
    Encoded as a `set=option;set=option` string: glTF extras only carry scalars.
    """
    count = 0
    for obj in objects:
        obj["usdVariantPrim"] = prim
        merged = {}
        for part in str(obj.get("usdVariants", "")).split(";"):
            if "=" in part:
                key, value = part.split("=", 1)
                merged[key] = value
        merged.update(selections)
        obj["usdVariants"] = ";".join("%s=%s" % (k, v) for k, v in sorted(merged.items()))
        count += 1
    return count


def scene_vertex_count():
    return sum(len(o.data.vertices) for o in bpy.data.objects if o.type == "MESH" and o.data)


def bake_variant_layers(manifest, vertex_budget, time_budget):
    """Imports one pass per variant option and keeps only the subtree concerned.

    Baking the variants into the GLB is what makes their switching **instant and available
    after publication**: the viewer only has to show the chosen subtree and hide the
    others, without reconversion. The cost is additive (sum of the options), not
    combinatorial: each option is imported with the other variant sets at their default value.

    Each pass is **masked at the carrier prim** (`prim_path_mask`, 46.P): Blender only
    converts the subtree that varies. Without the mask, each option re-imported the whole
    scene, and a production scene (200 sets) made the baking impracticable.
    The importer recreates the ancestor lineage with its local transforms, so the
    re-attachment to the original prim stays identical.

    The mask is a USD **population** mask: outside the mask, the prim no longer exists on the
    stage, bound material included. The manifest therefore adds the materials stored
    elsewhere (`buildVariantMask`), failing which the baked objects came out without material:
    white mirror metal in the viewer, since the glTF spec imposes the default material.

    Two budgets bound the breakage: vertices (GLB weight) and time (worker timeout).
    Beyond that, the remaining options are not baked and the summary reports it.
    """
    import time

    started = time.monotonic()
    defaults = defaults_by_prim(manifest)
    baked = []
    skipped = []
    for entry in manifest:
        prim, set_name, option = entry["prim"], entry["set"], entry["option"]
        over_time = time_budget > 0 and (time.monotonic() - started) > time_budget
        if scene_vertex_count() > vertex_budget or over_time:
            skipped.append({"prim": prim, "set": set_name, "option": option})
            continue

        before = set(bpy.data.objects)
        try:
            bpy.ops.wm.usd_import(
                **supported(
                    bpy.ops.wm.usd_import,
                    {
                        "filepath": os.path.abspath(entry["stage"]),
                        "prim_path_mask": entry.get("mask") or prim,
                    },
                )
            )
        except Exception as exc:
            print("variante %s=%s non importee: %s" % (set_name, option, exc), file=sys.stderr)
            continue
        fresh = [o for o in bpy.data.objects if o not in before]

        # Only the content UNDER the carrier prim differs: all the rest of this pass is a
        # duplicate of the base scene. So we keep the strict descendants and re-attach them
        # to the original prim, otherwise, since the pass's parent is deleted, the subtree
        # would end up at the root and lose the transforms of its ancestors.
        host = next((o for o in before if o.get("usdPath") == prim), None)
        keep, drop = [], []
        for obj in fresh:
            (keep if usd_path_of(obj).startswith(prim + "/") else drop).append(obj)
        for obj in keep:
            if obj.parent in drop or obj.parent is None:
                obj.parent = host
                obj.matrix_parent_inverse.identity()
        for obj in drop:
            bpy.data.objects.remove(obj, do_unlink=True)

        for obj in keep:
            obj["usdPath"] = usd_path_of(obj)
        # The subtree of this option is composed with the OTHER sets of the prim at their
        # default value: it therefore carries all these memberships, not only its own, otherwise
        # it would stay visible when another set of the same prim changes (duplicates, 46.R).
        selections = dict(defaults.get(prim, {}))
        selections[set_name] = option
        tag_variant_membership(keep, prim, selections)
        baked.append({"prim": prim, "set": set_name, "option": option, "objects": len(keep)})
    return baked, skipped


def defaults_by_prim(manifest):
    """Default options of each set, grouped by carrier prim."""
    defaults = {}
    for entry in manifest:
        defaults.setdefault(entry["prim"], {}).setdefault(entry["set"], entry["default"])
    return defaults


def tag_default_variants(manifest):
    """Labels the subtree already present as the **default** option of its sets.

    Without this, the viewer would know how to show the baked options but not how to hide
    the original one. All the sets of the prim are set at once: the base scene is composed
    with each one at its default value.
    """
    for prim, selections in defaults_by_prim(manifest).items():
        # STRICT descendants: the carrier prim itself stays out of the variant, otherwise
        # hiding it to show another option would also hide that other option, which is
        # re-attached under it.
        members = [o for o in bpy.data.objects if o.get("usdPath", "").startswith(prim + "/")]
        tag_variant_membership(members, prim, selections)


def apply_timing(args):
    scene = bpy.context.scene
    if args.fps and args.fps > 0:
        scene.render.fps = max(1, int(round(args.fps)))
        scene.render.fps_base = scene.render.fps / args.fps
    # The importer already sets the range via set_frame_range; we only force it if the analyzer
    # provided timeCodes, otherwise the export falls back to the default range (1-250) and
    # truncates the animation.
    if args.frame_start is not None and args.frame_end is not None:
        start = int(round(args.frame_start))
        end = int(round(args.frame_end))
        if end >= start:
            scene.frame_start = start
            scene.frame_end = end
    return scene


def export_glb(path, animate):
    options = {
        "filepath": path,
        "export_format": "GLB",
        "export_apply": True,
        "export_cameras": True,
        "export_lights": True,
        "export_yup": True,
        # Phase 46: carries `usdPath` through to the glTF node (prim <-> rendered object match).
        "export_extras": True,
        "export_skins": True,
        "export_morph": True,
        "export_image_format": "AUTO",
        "export_animations": animate,
        "export_frame_range": animate,
        "export_animation_mode": "SCENE",
        "export_bake_animation": animate,
    }
    result = bpy.ops.export_scene.gltf(**supported(bpy.ops.export_scene.gltf, options))
    if "FINISHED" not in result:
        raise RuntimeError("export glTF refuse par Blender (%s)" % ", ".join(result))


def summarize(scene, animate, tagged, baked, skipped):
    objects = list(bpy.data.objects)
    return {
        "objects": len(objects),
        "meshes": len([o for o in objects if o.type == "MESH"]),
        "armatures": len([o for o in objects if o.type == "ARMATURE"]),
        "cameras": len([o for o in objects if o.type == "CAMERA"]),
        "materials": len(bpy.data.materials),
        "images": len(bpy.data.images),
        "frameStart": scene.frame_start,
        "frameEnd": scene.frame_end,
        "fps": scene.render.fps / scene.render.fps_base if scene.render.fps_base else scene.render.fps,
        "animated": bool(animate and scene.frame_end > scene.frame_start),
        "blender": bpy.app.version_string,
        "usdPaths": tagged,
        "variantsBaked": baked,
        "variantsSkipped": skipped,
    }


def main():
    args = parse_args(sys.argv)
    # Blender resolves relative paths its own way (current .blend file), so we always
    # pass it an absolute one.
    args.input = os.path.abspath(args.input)
    args.output = os.path.abspath(args.output)
    if not os.path.exists(args.input):
        raise RuntimeError("fichier USD introuvable: %s" % args.input)

    ensure_gltf_exporter()
    reset_scene()
    import_usd(args.input, args.purpose)
    tagged = tag_usd_paths()

    baked, skipped = [], []
    if args.variant_layers:
        with open(args.variant_layers, "r", encoding="utf-8") as handle:
            manifest = json.load(handle)
        tag_default_variants(manifest)
        baked, skipped = bake_variant_layers(manifest, args.variant_vertex_budget, args.variant_time_budget)
        # The variant passes added objects: we re-tag them (idempotent).
        tagged = tag_usd_paths()
    scene = apply_timing(args)

    if not bpy.data.objects:
        raise RuntimeError("scene USD vide apres import (purpose '%s' sans geometrie ?)" % args.purpose)

    animate = not args.no_animation
    export_glb(args.output, animate)

    if not os.path.exists(args.output) or os.path.getsize(args.output) == 0:
        raise RuntimeError("GLB de sortie vide ou absent")

    sys.stdout.write("%s %s\n" % (MARKER, json.dumps(summarize(scene, animate, tagged, baked, skipped))))
    sys.stdout.flush()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Short message on stderr (no traceback): the worker relays it as is in
        # `metadata.processingError`, so it shows up in review.
        print("%s: %s" % (type(error).__name__, error), file=sys.stderr)
        sys.stderr.flush()
        sys.exit(1)
