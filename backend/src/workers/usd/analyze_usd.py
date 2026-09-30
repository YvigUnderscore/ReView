#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Analyse d'une scene USD pour le worker ReView (Phase 45, 45.B).

Ce script est le seul endroit du pipeline qui parle reellement USD : il s'appuie sur le
runtime OpenUSD officiel (module `pxr`, paquet `usd-core` installe dans /opt/usdenv) pour
repondre a trois questions que ni assimp ni Blender ne savent traiter proprement :

  1. **quelle couche est la racine** d'une livraison en archive (graphe de dependances) ;
  2. **quels assets manquent** (textures/couches non resolues) — sinon le modele arrive
     silencieusement gris en review ;
  3. **quelles variantes et quels purposes** la scene expose, pour pouvoir la recomposer.

Il ecrit **un seul objet JSON sur stdout** ; tout le reste (avertissements USD) part sur
stderr. Toute erreur fatale sort en code != 0 avec un message sur stderr.

Modes :
  scan    --input <dossier>            -> { "layers": [ { "layer", "deps" } ] }
  inspect --input <fichier usd/usdz>   -> description complete de la scene
          [--variants-file <json>] [--overlay-out <fichier.usda>]

L'option --overlay-out ecrit une **couche d'overlay** qui sous-couche la racine et force une
selection de variantes. C'est la maniere USD de recomposer sans toucher au fichier d'origine
et sans aplatir la scene (un Flatten casserait les chemins relatifs vers les textures).
"""

import argparse
import json
import os
import sys

USD_EXTENSIONS = (".usd", ".usda", ".usdc")
# Bornes de parcours : une scene de production peut contenir des millions de prims, on ne
# lit que ce qu'il faut pour la fiche technique sans immobiliser le worker.
MAX_PRIMS_SCANNED = 200000
MAX_VARIANT_SETS = 200
MAX_MISSING_REPORTED = 50
# Scenegraph (46.A) : au-dela, l'arbre est tronque — une scene de production peut porter
# des millions de prims, la review n'en affiche jamais autant.
MAX_PRIMS_REPORTED = 5000
# Materiaux rapportes pour la cuisson des variantes : ils servent a peupler le masque
# d'import de Blender, pas a l'affichage — inutile d'en lister des dizaines de milliers.
MAX_MATERIALS_REPORTED = 2000


def _posix(path):
    return path.replace(os.sep, "/")


def _relative(path, base):
    try:
        return _posix(os.path.relpath(path, base))
    except ValueError:  # lecteurs Windows differents — on garde le chemin tel quel
        return _posix(path)


def _list_usd_layers(directory):
    found = []
    for root, _dirs, files in os.walk(directory):
        for name in files:
            if name.lower().endswith(USD_EXTENSIONS):
                found.append(os.path.join(root, name))
    return sorted(found)


def _dependencies(asset_path):
    """(couches, assets, non_resolus) transitifs d'une couche, via UsdUtils."""
    from pxr import UsdUtils

    layers, assets, unresolved = UsdUtils.ComputeAllDependencies(asset_path)
    layer_paths = [layer.realPath or layer.identifier for layer in layers if layer]
    return layer_paths, list(assets), list(unresolved)


def cmd_scan(directory):
    """Graphe de dependances entre couches — la racine est choisie cote TypeScript."""
    layers = _list_usd_layers(directory)
    result = []
    for layer_path in layers:
        try:
            deps, _assets, _unresolved = _dependencies(layer_path)
        except Exception as exc:  # une couche illisible ne doit pas condamner le scan
            print("layer illisible %s: %s" % (layer_path, exc), file=sys.stderr)
            deps = []
        self_relative = _relative(layer_path, directory)
        dep_relative = [
            _relative(dep, directory)
            for dep in deps
            if dep and _relative(dep, directory) != self_relative
        ]
        result.append({"layer": self_relative, "deps": dep_relative})
    return {"layers": result}


def _variant_sets(stage):
    sets = []
    for index, prim in enumerate(stage.TraverseAll()):
        if index >= MAX_PRIMS_SCANNED or len(sets) >= MAX_VARIANT_SETS:
            break
        variant_sets = prim.GetVariantSets()
        for name in variant_sets.GetNames():
            variant_set = variant_sets.GetVariantSet(name)
            sets.append(
                {
                    "prim": str(prim.GetPath()),
                    "name": name,
                    "options": list(variant_set.GetVariantNames()),
                    "selected": variant_set.GetVariantSelection() or "",
                }
            )
    return sets


def _scan_stage(stage):
    """Purposes, taille, squelette et chemins des materiaux — en un seul parcours.

    Les chemins de materiaux ne servent pas la fiche technique mais la **cuisson des
    variantes** : Blender masque l'import d'une option a son prim porteur, et un masque de
    peuplement USD retire du stage tout ce qui est en dehors. Un materiau range ailleurs
    (bibliotheque partagee `/World/mtl`) devient alors introuvable et le maillage arrive
    sans materiau — donc en metal blanc miroir dans le viewer, la spec glTF imposant le
    materiau par defaut. Les chemins collectes ici sont ajoutes au masque (46.G).
    """
    from pxr import UsdGeom

    purposes = set()
    materials = []
    prim_count = 0
    has_skel = False
    for prim in stage.TraverseAll():
        prim_count += 1
        if prim_count > MAX_PRIMS_SCANNED:
            break
        type_name = prim.GetTypeName()
        if not has_skel and type_name in ("SkelRoot", "Skeleton", "SkelAnimation"):
            has_skel = True
        if type_name == "Material" and len(materials) < MAX_MATERIALS_REPORTED:
            materials.append(str(prim.GetPath()))
        imageable = UsdGeom.Imageable(prim)
        if imageable:
            purpose = imageable.GetPurposeAttr().Get()
            if purpose:
                purposes.add(str(purpose))
    return sorted(purposes), prim_count, has_skel, materials


def _prim_tree(stage):
    """Arbre des prims a plat (Phase 46, 46.A) — structure du scenegraph affiche en review.

    A plat plutot qu'imbrique : la validation Zod et le transport sont plus simples, et le
    front reconstruit la hierarchie a partir des chemins. Contient aussi les prims **non
    rendus** (variante inactive, purpose filtre) : c'est justement l'interet d'un vrai
    scenegraph par rapport a l'arbre des noeuds glTF.
    """
    from pxr import UsdGeom

    prims = []
    for prim in stage.TraverseAll():
        if len(prims) >= MAX_PRIMS_REPORTED:
            break
        path = str(prim.GetPath())
        if path == "/":
            continue
        purpose = ""
        imageable = UsdGeom.Imageable(prim)
        if imageable:
            value = imageable.GetPurposeAttr().Get()
            purpose = str(value) if value else ""
        prims.append(
            {
                "path": path,
                "name": prim.GetName(),
                "type": str(prim.GetTypeName() or ""),
                "kind": str(prim.GetMetadata("kind") or ""),
                "purpose": purpose,
                "variantSets": list(prim.GetVariantSets().GetNames()),
                "active": bool(prim.IsActive()),
                "instanceable": bool(prim.IsInstanceable()),
            }
        )
    return prims


def _apply_variant_selections(stage, selections):
    """Applique {prim: {variantSet: valeur}} sur la cible d'edition courante."""
    applied = []
    for prim_path, wanted in selections.items():
        prim = stage.OverridePrim(prim_path)
        if not prim:
            continue
        variant_sets = prim.GetVariantSets()
        for set_name, value in wanted.items():
            variant_set = variant_sets.GetVariantSet(set_name)
            if not variant_set:
                continue
            if value not in variant_set.GetVariantNames():
                print(
                    "variante inconnue ignoree: %s.%s=%s" % (prim_path, set_name, value),
                    file=sys.stderr,
                )
                continue
            variant_set.SetVariantSelection(value)
            applied.append({"prim": prim_path, "name": set_name, "value": value})
    return applied


def _write_overlay(root_path, selections, overlay_out):
    """Couche d'overlay sous-couchant la racine, portant la selection de variantes."""
    from pxr import Sdf, Usd

    overlay_dir = os.path.dirname(os.path.abspath(overlay_out)) or "."
    os.makedirs(overlay_dir, exist_ok=True)
    if os.path.exists(overlay_out):
        os.remove(overlay_out)

    layer = Sdf.Layer.CreateNew(overlay_out)
    # Chemin relatif : l'overlay vit a cote de la racine, les assets restent resolus.
    layer.subLayerPaths.append(_relative(os.path.abspath(root_path), overlay_dir))
    stage = Usd.Stage.Open(layer)
    applied = _apply_variant_selections(stage, selections)
    stage.GetRootLayer().Save()
    return applied


def cmd_overlays(root_path, manifest):
    """Ecrit N couches d'overlay en une seule invocation (46.P).

    `prepareVariantLayers` invoquait ce script une fois **par option a cuire**, chaque appel
    recomposant la scene entiere — une scene de production (Kitchen_set : 200 jeux de
    variantes) rendait la preparation prohibitive. Ici, aucune composition : la selection est
    posee en pur Sdf (`over` + `variantSelections`), la validite des options ayant deja ete
    etablie par l'inspection initiale.
    """
    from pxr import Sdf

    written = 0
    for entry in manifest:
        out = os.path.abspath(entry["out"])
        overlay_dir = os.path.dirname(out) or "."
        os.makedirs(overlay_dir, exist_ok=True)
        if os.path.exists(out):
            os.remove(out)
        layer = Sdf.Layer.CreateNew(out)
        # Chemin relatif : l'overlay vit a cote de la racine, les assets restent resolus.
        layer.subLayerPaths.append(_relative(os.path.abspath(root_path), overlay_dir))
        for prim_path, wanted in entry["variants"].items():
            spec = Sdf.CreatePrimInLayer(layer, prim_path)
            spec.specifier = Sdf.SpecifierOver
            for set_name, value in wanted.items():
                spec.variantSelections.update({set_name: value})
        layer.Save()
        written += 1
    return {"written": written}


def cmd_inspect(input_path, selections, overlay_out):
    from pxr import Usd, UsdGeom

    stage_path = input_path
    applied_variants = []
    if selections and overlay_out:
        applied_variants = _write_overlay(input_path, selections, overlay_out)
        stage_path = overlay_out

    stage = Usd.Stage.Open(stage_path)
    if not stage:
        raise RuntimeError("stage USD illisible: %s" % stage_path)

    try:
        _layers, _assets, unresolved = _dependencies(input_path)
    except Exception as exc:
        print("dependances non calculees: %s" % exc, file=sys.stderr)
        _layers, unresolved = [], []

    base_dir = os.path.dirname(os.path.abspath(input_path)) or "."
    purposes, prim_count, has_skel, material_paths = _scan_stage(stage)
    prim_tree = _prim_tree(stage)
    start = stage.GetStartTimeCode()
    end = stage.GetEndTimeCode()
    default_prim = stage.GetDefaultPrim()

    return {
        "root": _relative(os.path.abspath(input_path), base_dir),
        "stagePath": _posix(os.path.abspath(stage_path)),
        "defaultPrim": str(default_prim.GetPath()) if default_prim else None,
        "upAxis": str(UsdGeom.GetStageUpAxis(stage)),
        "metersPerUnit": float(UsdGeom.GetStageMetersPerUnit(stage)),
        "startTimeCode": float(start),
        "endTimeCode": float(end),
        "timeCodesPerSecond": float(stage.GetTimeCodesPerSecond()),
        "hasAnimation": bool(end > start),
        "hasSkeleton": has_skel,
        "variantSets": _variant_sets(stage),
        "appliedVariants": applied_variants,
        "purposes": purposes,
        "materialPaths": material_paths,
        "missingAssets": [_relative(p, base_dir) for p in unresolved[:MAX_MISSING_REPORTED]],
        "missingAssetsTotal": len(unresolved),
        "layerCount": len(_layers),
        "primCount": prim_count,
        "prims": prim_tree,
        "primsTruncated": len(prim_tree) >= MAX_PRIMS_REPORTED,
    }


def main(argv):
    parser = argparse.ArgumentParser(description="Analyse USD pour ReView")
    parser.add_argument("mode", choices=["scan", "inspect", "overlays"])
    parser.add_argument("--input", required=True, help="dossier (scan) ou fichier USD/USDZ (inspect)")
    parser.add_argument("--variants-file", help="JSON {prim: {variantSet: valeur}}")
    parser.add_argument("--overlay-out", help="couche d'overlay a ecrire (selection de variantes)")
    parser.add_argument("--manifest", help="JSON [{out, variants}] — mode overlays (46.P)")
    args = parser.parse_args(argv)

    if not os.path.exists(args.input):
        print("introuvable: %s" % args.input, file=sys.stderr)
        return 2

    if args.mode == "scan":
        payload = cmd_scan(args.input)
    elif args.mode == "overlays":
        if not args.manifest:
            print("--manifest requis en mode overlays", file=sys.stderr)
            return 2
        with open(args.manifest, "r", encoding="utf-8") as handle:
            payload = cmd_overlays(args.input, json.load(handle))
    else:
        selections = {}
        if args.variants_file:
            with open(args.variants_file, "r", encoding="utf-8") as handle:
                selections = json.load(handle)
        payload = cmd_inspect(args.input, selections, args.overlay_out)

    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as error:  # message exploitable cote worker, pas de traceback brut
        print(str(error), file=sys.stderr)
        sys.exit(1)
