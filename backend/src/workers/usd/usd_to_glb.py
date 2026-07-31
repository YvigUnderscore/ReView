#!/usr/bin/env python3
"""Conversion USD -> GLB via Blender headless (Phase 45, 45.C).

Invoque par le worker :

    blender -b --factory-startup --python usd_to_glb.py -- \\
        --input scene.usda --output model.glb [--purpose render] \\
        [--frame-start 1 --frame-end 96 --fps 24]

Pourquoi Blender : il embarque OpenUSD complet. Il compose donc references, payloads,
sublayers et variantes, traduit UsdPreviewSurface en materiaux PBR, importe UsdSkel
(squelettes + animation) et les cameras, puis reexporte tout en glTF binaire — le seul
format que lit le viewer Three.js de la review.

Le fichier d'origine n'est jamais modifie : Blender lit, exporte ailleurs, et le worker
ne repousse que le GLB derive.

Sortie : une ligne `REVIEW_USD_JSON {...}` sur stdout (Blender bavarde beaucoup, le marqueur
permet au worker de retrouver le resume sans ambiguite).
"""

import json
import os
import sys

import bpy  # fourni par Blender

MARKER = "REVIEW_USD_JSON"
# Purposes USD : ce qui est rendu (render), le proxy d'affichage rapide (proxy) et les
# aides de mise en scene (guide, jamais souhaitables en review).
PURPOSES = ("render", "proxy", "guide")


def parse_args(argv):
    """Arguments situes apres le `--` de la ligne de commande Blender."""
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
    return parser.parse_args(argv)


def supported(operator, wanted):
    """Ne garde que les options reellement exposees par cette version de Blender.

    Les noms d'options de `wm.usd_import` et `export_scene.gltf` bougent d'une version a
    l'autre ; filtrer sur le RNA evite qu'une montee de version casse la conversion.
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
    """Scene vide : sans cela, le cube/camera/lampe par defaut finissent dans le GLB."""
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


def apply_timing(args):
    scene = bpy.context.scene
    if args.fps and args.fps > 0:
        scene.render.fps = max(1, int(round(args.fps)))
        scene.render.fps_base = scene.render.fps / args.fps
    # L'importeur pose deja la plage via set_frame_range ; on ne la force que si l'analyseur
    # a fourni des timeCodes, sinon l'export retombe sur la plage par defaut (1-250) et
    # tronque l'animation.
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
        "export_extras": False,
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


def summarize(scene, animate):
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
    }


def main():
    args = parse_args(sys.argv)
    # Blender resout les chemins relatifs a sa maniere (fichier .blend courant) : on lui
    # passe systematiquement de l'absolu.
    args.input = os.path.abspath(args.input)
    args.output = os.path.abspath(args.output)
    if not os.path.exists(args.input):
        raise RuntimeError("fichier USD introuvable: %s" % args.input)

    ensure_gltf_exporter()
    reset_scene()
    import_usd(args.input, args.purpose)
    scene = apply_timing(args)

    if not bpy.data.objects:
        raise RuntimeError("scene USD vide apres import (purpose '%s' sans geometrie ?)" % args.purpose)

    animate = not args.no_animation
    export_glb(args.output, animate)

    if not os.path.exists(args.output) or os.path.getsize(args.output) == 0:
        raise RuntimeError("GLB de sortie vide ou absent")

    sys.stdout.write("%s %s\n" % (MARKER, json.dumps(summarize(scene, animate))))
    sys.stdout.flush()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Message court sur stderr (pas de traceback) : le worker le remonte tel quel dans
        # `metadata.processingError`, donc en review.
        print("%s: %s" % (type(error).__name__, error), file=sys.stderr)
        sys.stderr.flush()
        sys.exit(1)
