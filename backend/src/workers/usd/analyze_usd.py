#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Analyse a USD scene for the ReView worker (Phase 45, 45.B).

This script is the only place in the pipeline that really speaks USD: it relies on the
official OpenUSD runtime (`pxr` module, `usd-core` package installed in /opt/usdenv) to
answer three questions that neither assimp nor Blender can handle cleanly:

  1. **which layer is the root** of an archived delivery (dependency graph);
  2. **which assets are missing** (unresolved textures or layers), otherwise the model
     silently arrives grey in review;
  3. **which variants and which purposes** the scene exposes, so it can be recomposed.

It writes **a single JSON object on stdout**; everything else (USD warnings) goes to
stderr. Any fatal error exits with a non-zero code and a message on stderr.

Modes:
  scan    --input <folder>             -> { "layers": [ { "layer", "deps" } ] }
  inspect --input <file usd/usdz>      -> full description of the scene
          [--variants-file <json>] [--overlay-out <file.usda>]

The --overlay-out option writes an **overlay layer** that sublayers the root and forces a
variant selection. This is the USD way to recompose without touching the original file
and without flattening the scene (a Flatten would break the relative paths to textures).
"""

import argparse
import json
import os
import sys

USD_EXTENSIONS = (".usd", ".usda", ".usdc")
# Traversal bounds: a production scene can contain millions of prims, so we
# read only what the spec sheet needs without tying up the worker.
MAX_PRIMS_SCANNED = 200000
MAX_VARIANT_SETS = 200
MAX_MISSING_REPORTED = 50
# Scenegraph (46.A): beyond this, the tree is truncated; a production scene can carry
# millions of prims, and the review never shows that many.
MAX_PRIMS_REPORTED = 5000
# Materials reported for variant baking: they populate Blender's import mask,
# not the display, so there is no point listing tens of thousands of them.
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
    """(layers, assets, unresolved) transitively for a layer, via UsdUtils."""
    from pxr import UsdUtils

    layers, assets, unresolved = UsdUtils.ComputeAllDependencies(asset_path)
    layer_paths = [layer.realPath or layer.identifier for layer in layers if layer]
    return layer_paths, list(assets), list(unresolved)


def cmd_scan(directory):
    """Dependency graph between layers: the root is chosen on the TypeScript side."""
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
    """Purposes, size, skeleton and material paths, in a single pass.

    Material paths do not serve the spec sheet but the **baking of variants**: Blender masks
    the import of an option to its carrier prim, and a population mask of USD removes
    everything outside it from the stage. A material stored elsewhere (shared library
    `/World/mtl`) then becomes unreachable, and the mesh arrives without material: white
    mirror metal in the viewer, since the glTF spec imposes the default material. The paths
    collected here are added to the mask (46.G).
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
    """Flat list of prims (Phase 46, 46.A): the scenegraph structure displayed in review.

    Flat rather than nested: Zod validation and transport are simpler, and the front end
    rebuilds the hierarchy from the paths. It also contains the **unrendered** prims
    (inactive variant, filtered purpose): that is precisely the point of a real scenegraph
    compared with the glTF node tree.
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
    """Applies {prim: {variantSet: value}} to the current edit target."""
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
    """Overlay layer sublayering the root, carrying the variant selection."""
    from pxr import Sdf, Usd

    overlay_dir = os.path.dirname(os.path.abspath(overlay_out)) or "."
    os.makedirs(overlay_dir, exist_ok=True)
    if os.path.exists(overlay_out):
        os.remove(overlay_out)

    layer = Sdf.Layer.CreateNew(overlay_out)
    # Relative path: the overlay lives next to the root, and the assets stay resolved.
    layer.subLayerPaths.append(_relative(os.path.abspath(root_path), overlay_dir))
    stage = Usd.Stage.Open(layer)
    applied = _apply_variant_selections(stage, selections)
    stage.GetRootLayer().Save()
    return applied


def cmd_overlays(root_path, manifest):
    """Writes N overlay layers in a single invocation (46.P).

    `prepareVariantLayers` used to invoke this script **once per option to bake**, each call
    recomposing the whole scene: on a production scene (Kitchen_set: 200 variant sets) the
    preparation was prohibitive. Here there is no composition: the selection is set in pure
    Sdf (`over` + `variantSelections`), the validity of the options having already been
    established by the initial inspection.
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
        # Relative path: the overlay lives next to the root, and the assets stay resolved.
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
