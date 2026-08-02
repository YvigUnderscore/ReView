#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

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
import re
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
    parser.add_argument("--variant-layers", help="manifeste JSON des options de variantes a cuire")
    parser.add_argument("--variant-vertex-budget", type=int, default=8_000_000)
    # Budget de TEMPS de cuisson en secondes (0 = illimite) : sur une scene a beaucoup de
    # variantes, mieux vaut livrer un GLB avec une partie des options cuites que de faire
    # expirer le timeout du worker et perdre toute la conversion.
    parser.add_argument("--variant-time-budget", type=float, default=0)
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


def tag_usd_paths():
    """Inscrit sur chaque objet le chemin du prim USD dont il provient (Phase 46, 46.A).

    L'importeur USD de Blender n'expose pas ce chemin, mais il **reproduit fidelement la
    hierarchie** des prims dans celle des objets : `World > Asset > Geo > Suzanne` vient de
    `/World/Asset/Geo/Suzanne`. On la remonte donc parent par parent.

    Blender desambiguise les noms en collision avec un suffixe `.001` : il faut le retirer,
    sinon le chemin reconstruit ne correspondrait a aucun prim. C'est fait juste apres
    l'import, avant toute autre manipulation de la scene.

    Le chemin part ensuite dans les `extras` du noeud glTF (`export_extras`), ce qui donne au
    viewer la correspondance noeud rendu -> prim USD : sans elle, ni scenegraph ni override
    par prim ne sont possibles.
    """
    tagged = 0
    for obj in bpy.data.objects:
        obj["usdPath"] = usd_path_of(obj)
        tagged += 1
    return tagged


def usd_path_of(obj):
    """Chemin de prim d'un objet, reconstruit depuis sa lignee (suffixes .NNN retires)."""
    names = []
    node = obj
    while node is not None:
        names.append(re.sub(r"\.\d{3}$", "", node.name))
        node = node.parent
    return "/" + "/".join(reversed(names))


def tag_variant_membership(objects, prim, selections):
    """Marque les objets d'un sous-arbre comme appartenant a des options de variantes.

    `selections` est un dict set -> option, fusionne avec l'existant : un prim peut porter
    **plusieurs** jeux (Kitchen_set : les assiettes ont modelingVariant ET shadingVariant).
    L'ancien marquage a cle unique s'ecrasait d'un jeu a l'autre — changer un jeu laissait la
    geometrie de base visible a cote de l'option cuite, d'ou des doublons a l'ecran (46.R).
    Encode en chaine `set=option;set=option` : les extras glTF ne portent que des scalaires.
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
    """Importe une passe par option de variante et ne garde que le sous-arbre concerne.

    Cuire les variantes dans le GLB est ce qui rend leur bascule **instantanee et disponible
    apres publication** : le viewer n'a plus qu'a montrer le sous-arbre choisi et masquer les
    autres, sans reconversion. Le cout est additif (somme des options), pas combinatoire :
    chaque option est importee avec les autres jeux de variantes a leur valeur par defaut.

    Chaque passe est **masquee au prim porteur** (`prim_path_mask`, 46.P) : Blender ne
    convertit que le sous-arbre qui varie — sans le masque, chaque option reimportait la
    scene entiere et une scene de production (200 jeux) rendait la cuisson impraticable.
    L'importeur recree la lignee d'ancetres avec ses transformations locales, le
    rebranchement sur le prim d'origine reste donc identique.

    Deux budgets bornent la casse : sommets (poids du GLB) et temps (timeout du worker).
    Au-dela, les options restantes ne sont pas cuites et le resume le signale.
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
                    {"filepath": os.path.abspath(entry["stage"]), "prim_path_mask": prim},
                )
            )
        except Exception as exc:
            print("variante %s=%s non importee: %s" % (set_name, option, exc), file=sys.stderr)
            continue
        fresh = [o for o in bpy.data.objects if o not in before]

        # Seul le contenu SOUS le prim porteur differe : tout le reste de cette passe est un
        # doublon de la scene de base. On garde donc la descendance stricte et on la rebranche
        # sur le prim d'origine — sinon, le parent de la passe etant supprime, le sous-arbre
        # se retrouverait a la racine et perdrait les transformations de ses ancetres.
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
        # Le sous-arbre de cette option est compose avec les AUTRES jeux du prim a leur valeur
        # par defaut : il porte donc toutes ces appartenances, pas seulement la sienne — sinon
        # il resterait visible quand un autre jeu du meme prim change (doublons, 46.R).
        selections = dict(defaults.get(prim, {}))
        selections[set_name] = option
        tag_variant_membership(keep, prim, selections)
        baked.append({"prim": prim, "set": set_name, "option": option, "objects": len(keep)})
    return baked, skipped


def defaults_by_prim(manifest):
    """Options par defaut de chaque jeu, regroupees par prim porteur."""
    defaults = {}
    for entry in manifest:
        defaults.setdefault(entry["prim"], {}).setdefault(entry["set"], entry["default"])
    return defaults


def tag_default_variants(manifest):
    """Etiquette le sous-arbre deja present comme etant l'option **par defaut** de ses jeux.

    Sans cela, le viewer saurait montrer les options cuites mais pas masquer celle d'origine.
    Tous les jeux du prim sont poses en une fois : la scene de base est composee avec chacun
    a sa valeur par defaut.
    """
    for prim, selections in defaults_by_prim(manifest).items():
        # Descendance **stricte** : le prim porteur lui-meme reste hors variante, sinon le
        # masquer pour afficher une autre option masquerait aussi cette autre option, qui est
        # rebranchee sous lui.
        members = [o for o in bpy.data.objects if o.get("usdPath", "").startswith(prim + "/")]
        tag_variant_membership(members, prim, selections)


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
        # Phase 46 : porte `usdPath` jusqu'au noeud glTF (correspondance prim <-> objet rendu).
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
    # Blender resout les chemins relatifs a sa maniere (fichier .blend courant) : on lui
    # passe systematiquement de l'absolu.
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
        # Les passes de variantes ont ajoute des objets : on re-etiquette (idempotent).
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
        # Message court sur stderr (pas de traceback) : le worker le remonte tel quel dans
        # `metadata.processingError`, donc en review.
        print("%s: %s" % (type(error).__name__, error), file=sys.stderr)
        sys.stderr.flush()
        sys.exit(1)
