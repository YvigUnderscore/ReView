# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Assemblage de la scene USD d'un plan (projet de demonstration).

Un plan n'est pas un fichier : c'est une **pile de couches**, une par departement, que
chacun ecrit sans jamais toucher a celle du voisin.

    SH0140/
      SH0140.usda          couche racine : subLayers, bornes temporelles, cadence
      layout/…_layout.usda mise en place : references vers les assets + placement
      anim/…_anim.usda     animation : `over` + timeSamples sur les memes prims
      light/…_light.usda   eclairage : UsdLux, et rien d'autre
      fx/…_fx.usda         effets
      assets/…             les assets references, avec leur propre graphe

L'ordre des sous-couches va du **plus fort au plus faible** (`light` gagne sur `anim`, qui
gagne sur `layout`) : c'est la regle USD, et c'est ce qui permet a l'eclairage de corriger
une transformation d'animation sans que personne ne reecrive le layout.

Usage : python build_usd_shot.py <spec.json>
Ecrit une ligne `SAMPLE_USD_JSON {...}`.
"""

import json
import os
import sys

MARKER = "SAMPLE_USD_JSON"

# Capteur de reference du studio (35 mm academy, largeur 36 mm) : la focale d'un plan se
# lit en millimetres, jamais en champ de vision.
APERTURE_MM = 36.0


def _vec(values):
    return "(%s)" % ", ".join("%g" % v for v in values)


def _time_samples(indent, attr_type, attr, samples):
    lines = ["%s%s %s.timeSamples = {" % (indent, attr_type, attr)]
    for frame in sorted(samples, key=float):
        lines.append("%s    %s: %s," % (indent, frame, _vec(samples[frame])))
    lines.append("%s}" % indent)
    return lines


def _xform_ops(indent, entry, animated=False):
    """Bloc de transformation : ordre d'operations explicite, comme en production."""
    lines = []
    translate = entry.get("translate", [0, 0, 0])
    rotate = entry.get("rotate", [0, 0, 0])
    scale = entry.get("scale", 1.0)
    scale_vec = scale if isinstance(scale, list) else [scale, scale, scale]
    anim = entry.get("anim", {})
    if animated and "translate" in anim:
        lines += _time_samples(indent, "double3", "xformOp:translate", anim["translate"])
    else:
        lines.append("%sdouble3 xformOp:translate = %s" % (indent, _vec(translate)))
    if animated and "rotate" in anim:
        lines += _time_samples(indent, "float3", "xformOp:rotateXYZ", anim["rotate"])
    else:
        lines.append("%sfloat3 xformOp:rotateXYZ = %s" % (indent, _vec(rotate)))
    lines.append("%sfloat3 xformOp:scale = %s" % (indent, _vec(scale_vec)))
    lines.append(
        '%suniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateXYZ", "xformOp:scale"]'
        % indent
    )
    return lines


def write_layout(spec, path):
    """Mise en place : ce que le layout pose, et rien de plus."""
    shot = spec["shot"]
    lines = [
        "#usda 1.0",
        "(",
        '    defaultPrim = "World"',
        "    metersPerUnit = 1",
        '    upAxis = "Y"',
        '    doc = """Layout — %s. References the asset library and places it."""' % shot,
        ")",
        "",
        'def Xform "World" (',
        '    kind = "assembly"',
        ")",
        "{",
    ]
    groups = {}
    for entry in spec.get("assets", []):
        groups.setdefault(entry.get("group", "props"), []).append(entry)

    for group, entries in groups.items():
        lines += ['    def Scope "%s"' % group, "    {"]
        for entry in entries:
            # `path` est donne relativement au DOSSIER DU PLAN ; la couche de layout vit un
            # cran plus bas, et un chemin d'asset se resout toujours depuis la couche qui
            # l'introduit — d'ou le `../`.
            lines += [
                '        def Xform "%s" (' % entry["prim"],
                '            prepend references = @../%s@</%s>' % (entry["path"], entry["name"]),
                '            kind = "component"',
                ")",
                "        {",
            ]
            lines += _xform_ops("            ", entry)
            lines += ["        }"]
        lines += ["    }"]

    camera = spec.get("camera")
    if camera:
        lines += [
            '    def Camera "shotCam"',
            "    {",
            "        float focalLength = %g" % camera.get("focal", 50),
            "        float horizontalAperture = %g" % APERTURE_MM,
            "        float verticalAperture = %g" % (APERTURE_MM / camera.get("aspect", 2.39)),
            "        float2 clippingRange = (0.1, 10000)",
        ]
        lines += _xform_ops("        ", camera)
        lines += ["    }"]
    lines += ["}", ""]
    _write(path, "\n".join(lines))


def write_anim(spec, path):
    """Animation : uniquement des `over` et des timeSamples — jamais une definition."""
    shot = spec["shot"]
    animated = [e for e in spec.get("assets", []) if e.get("anim")]
    camera = spec.get("camera") or {}
    lines = [
        "#usda 1.0",
        "(",
        '    defaultPrim = "World"',
        "    metersPerUnit = 1",
        '    upAxis = "Y"',
        '    doc = """Animation — %s. Overrides only: the layout keeps the ownership."""' % shot,
        ")",
        "",
        'over "World"',
        "{",
    ]
    groups = {}
    for entry in animated:
        groups.setdefault(entry.get("group", "props"), []).append(entry)
    for group, entries in groups.items():
        lines += ['    over "%s"' % group, "    {"]
        for entry in entries:
            lines += ['        over "%s"' % entry["prim"], "        {"]
            lines += _xform_ops("            ", entry, animated=True)
            lines += ["        }"]
        lines += ["    }"]
    if camera.get("anim"):
        lines += ['    over "shotCam"', "    {"]
        lines += _xform_ops("        ", camera, animated=True)
        if camera.get("focalAnim"):
            lines.append("        float focalLength.timeSamples = {")
            for frame in sorted(camera["focalAnim"], key=float):
                lines.append("            %s: %g," % (frame, camera["focalAnim"][frame]))
            lines.append("        }")
        lines += ["    }"]
    lines += ["}", ""]
    _write(path, "\n".join(lines))


def write_light(spec, path):
    """Eclairage : UsdLux, dans sa couche, sous un Scope dedie."""
    shot = spec["shot"]
    lines = [
        "#usda 1.0",
        "(",
        '    defaultPrim = "World"',
        "    metersPerUnit = 1",
        '    upAxis = "Y"',
        '    doc = """Lighting — %s."""' % shot,
        ")",
        "",
        'over "World"',
        "{",
        '    def Scope "lights"',
        "    {",
    ]
    for light in spec.get("lights", []):
        kind = light.get("type", "DistantLight")
        lines += ['        def %s "%s"' % (kind, light["name"]), "        {"]
        lines.append("            float inputs:intensity = %g" % light.get("intensity", 1))
        lines.append("            color3f inputs:color = %s" % _vec(light.get("color", [1, 1, 1])))
        if kind == "DistantLight":
            lines.append("            float inputs:angle = %g" % light.get("angle", 0.53))
        if kind == "RectLight":
            lines.append("            float inputs:width = %g" % light.get("width", 4))
            lines.append("            float inputs:height = %g" % light.get("height", 4))
        if kind == "DomeLight" and light.get("texture"):
            lines.append("            asset inputs:texture:file = @%s@" % light["texture"])
        lines += _xform_ops("            ", light)
        lines += ["        }"]
    lines += ["    }", "}", ""]
    _write(path, "\n".join(lines))


def write_fx(spec, path):
    """Effets : une couche, meme quand elle ne contient qu'un volume de reference."""
    shot = spec["shot"]
    lines = [
        "#usda 1.0",
        "(",
        '    defaultPrim = "World"',
        "    metersPerUnit = 1",
        '    upAxis = "Y"',
        '    doc = """FX — %s."""' % shot,
        ")",
        "",
        'over "World"',
        "{",
        '    def Scope "fx"',
        "    {",
    ]
    for item in spec.get("fx", []):
        lines += ['        def %s "%s"' % (item.get("type", "Sphere"), item["name"]), "        {"]
        if item.get("type", "Sphere") == "Sphere":
            lines.append("            double radius = %g" % item.get("radius", 0.5))
        lines.append("            color3f[] primvars:displayColor = [%s]" % _vec(item.get("color", [1, 1, 1])))
        lines.append("            float[] primvars:displayOpacity = [%g]" % item.get("opacity", 0.35))
        lines += _xform_ops("            ", item)
        lines += ["        }"]
    lines += ["    }", "}", ""]
    _write(path, "\n".join(lines))


def write_root(spec, path, layers):
    """Couche racine : la pile, les bornes temporelles et la cadence du plan."""
    shot = spec["shot"]
    lines = [
        "#usda 1.0",
        "(",
        '    defaultPrim = "World"',
        "    metersPerUnit = 1",
        '    upAxis = "Y"',
        "    startTimeCode = %d" % spec["start"],
        "    endTimeCode = %d" % spec["end"],
        "    timeCodesPerSecond = %g" % spec.get("fps", 24),
        "    framesPerSecond = %g" % spec.get("fps", 24),
        "    subLayers = [",
        "        %s" % ",\n        ".join("@%s@" % layer for layer in layers),
        "    ]",
        '    doc = """Shot %s — strongest layer first: lighting, fx, animation, layout."""' % shot,
        ")",
        "",
    ]
    _write(path, "\n".join(lines))


def _write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)


def inspect(root):
    from pxr import Usd, UsdGeom

    stage = Usd.Stage.Open(root)
    if not stage:
        raise SystemExit("stage illisible: %s" % root)
    prims = [str(p.GetPath()) for p in stage.TraverseAll()]
    purposes = set()
    for prim in stage.TraverseAll():
        imageable = UsdGeom.Imageable(prim)
        if imageable:
            value = imageable.GetPurposeAttr().Get()
            if value:
                purposes.add(str(value))
    return {
        "root": root,
        "defaultPrim": str(stage.GetDefaultPrim().GetPath()) if stage.GetDefaultPrim() else None,
        "prims": len(prims),
        "purposes": sorted(purposes),
        "start": stage.GetStartTimeCode(),
        "end": stage.GetEndTimeCode(),
    }


def main():
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        spec = json.load(handle)
    shot_dir = spec["shotDir"]
    shot = spec["shot"]

    write_layout(spec, os.path.join(shot_dir, "layout", "%s_layout.usda" % shot))
    write_anim(spec, os.path.join(shot_dir, "anim", "%s_anim.usda" % shot))
    write_light(spec, os.path.join(shot_dir, "light", "%s_light.usda" % shot))
    layers = [
        "./light/%s_light.usda" % shot,
        "./anim/%s_anim.usda" % shot,
        "./layout/%s_layout.usda" % shot,
    ]
    if spec.get("fx"):
        write_fx(spec, os.path.join(shot_dir, "fx", "%s_fx.usda" % shot))
        layers.insert(1, "./fx/%s_fx.usda" % shot)

    root = os.path.join(shot_dir, "%s.usda" % shot)
    write_root(spec, root, layers)
    print("%s %s" % (MARKER, json.dumps(inspect(root))))


main()
