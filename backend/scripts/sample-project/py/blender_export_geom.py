# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Export de la geometrie d'un modele glTF vers des couches USD (projet de demonstration).

Blender n'intervient que pour **une** chose ici : lire un glTF et en ecrire la geometrie en
USD. Tout le reste du graphe — interface, payload, materiaux, variantes, plans — est ecrit
en USD pur par `build_usd_asset.py`, pour que la structure du sample soit celle d'un studio
et non celle d'un exporteur.

Deux couches sont produites par asset :

  * `<sortie>/<Nom>_render.usdc` — maillage complet, purpose `render` ;
  * `<sortie>/<Nom>_proxy.usdc`  — le meme maillage decime, purpose `proxy`.

Les materiaux sont volontairement **exclus** de l'export : ils vivent dans leur propre
couche, ecrite a la main, et sont lies par le variantSet de look.

Usage (Blender headless) :
    blender --background --python blender_export_geom.py -- --input a.gltf --name Lantern \
        --outdir /chemin/geom [--decimate 0.12] [--scale 1.0]

Ecrit une ligne `SAMPLE_GEOM_JSON {...}` sur stdout : chemins ecrits et chemins de prims.
"""

import json
import os
import sys

import bpy

MARKER = "SAMPLE_GEOM_JSON"


def _argv():
    """Arguments places apres le `--` de Blender."""
    argv = sys.argv
    return argv[argv.index("--") + 1 :] if "--" in argv else []


def _parse(args):
    out = {"decimate": 0.12, "scale": 1.0}
    key = None
    for token in args:
        if token.startswith("--"):
            key = token[2:]
            out.setdefault(key, True)
        elif key:
            out[key] = token
            key = None
    out["decimate"] = float(out["decimate"])
    out["scale"] = float(out["scale"])
    return out


def _clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _import_gltf(path):
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def _normalise(meshes, scale):
    """Ramene l'asset a l'origine, pose a plat, et le met a l'echelle demandee.

    Un asset de bibliotheque doit arriver **pose sur son origine** : sans cela, chaque plan
    qui le reference doit corriger la meme translation, et le viewer cadre sur du vide.
    """
    if not meshes:
        return
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for obj in meshes:
        for corner in obj.bound_box:
            world = obj.matrix_world @ __import__("mathutils").Vector(corner)
            for axis in range(3):
                lo[axis] = min(lo[axis], world[axis])
                hi[axis] = max(hi[axis], world[axis])
    centre_x = (lo[0] + hi[0]) / 2.0
    centre_y = (lo[1] + hi[1]) / 2.0
    for obj in meshes:
        obj.location.x -= centre_x
        obj.location.y -= centre_y
        obj.location.z -= lo[2]
        obj.scale = (obj.scale[0] * scale, obj.scale[1] * scale, obj.scale[2] * scale)
    bpy.context.view_layer.update()


def _rename(meshes, name):
    """Nommage stable des prims : `Lantern_part0`, `Lantern_part1`, …"""
    for index, obj in enumerate(meshes):
        obj.name = "%s_part%d" % (name, index)
        obj.data.name = obj.name


def _export(path, root_prim, subdiv=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.wm.usd_export(
        filepath=path,
        export_materials=False,
        export_textures_mode="KEEP",
        export_animation=False,
        export_cameras=False,
        export_lights=False,
        export_uvmaps=True,
        export_normals=True,
        export_subdivision="IGNORE" if not subdiv else "BEST_MATCH",
        root_prim_path=root_prim,
        relative_paths=True,
        convert_orientation=True,
        export_global_up_selection="Y",
        export_global_forward_selection="NEGATIVE_Z",
        evaluation_mode="RENDER",
    )


def _decimate(meshes, ratio):
    for obj in meshes:
        modifier = obj.modifiers.new(name="proxy", type="DECIMATE")
        modifier.ratio = ratio
    bpy.context.view_layer.update()


def main():
    opts = _parse(_argv())
    name = opts["name"]
    outdir = opts["outdir"]

    _clear_scene()
    meshes = _import_gltf(opts["input"])
    if not meshes:
        raise SystemExit("no mesh imported from %s" % opts["input"])
    _normalise(meshes, opts["scale"])
    _rename(meshes, name)

    render_path = os.path.join(outdir, "%s_render.usdc" % name)
    _export(render_path, "/%s/geom/render" % name)

    _decimate(meshes, opts["decimate"])
    proxy_path = os.path.join(outdir, "%s_proxy.usdc" % name)
    _export(proxy_path, "/%s/geom/proxy" % name)

    payload = {
        "name": name,
        "render": os.path.basename(render_path),
        "proxy": os.path.basename(proxy_path),
        "meshes": ["/%s/geom/render/%s" % (name, obj.name) for obj in meshes],
        "polygons": sum(len(obj.data.polygons) for obj in meshes),
    }
    print("%s %s" % (MARKER, json.dumps(payload)))


main()
