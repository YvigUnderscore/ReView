# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Assemblage du graphe USD d'un asset de bibliotheque (projet de demonstration).

La structure suit la maniere dont un studio range reellement un asset, et non ce qu'un
exporteur produit d'un bloc :

    Lantern/
      Lantern.usda            couche d'interface : `defaultPrim`, `kind = component`,
                              `assetInfo`, et un PAYLOAD vers la charge utile
      Lantern_payload.usda    charge utile : sous-couches (binding > materiaux > geometrie)
                              et les variantSets de look
      geom/Lantern_render.usdc  geometrie de rendu   (ecrite par Blender)
      geom/Lantern_proxy.usdc   geometrie allegee    (idem, decimee)
      mtl/Lantern_mtl.usda      bibliotheque de materiaux (UsdPreviewSurface + UsdUVTexture)
      mtl/Lantern_bind.usda     purposes et liaison par defaut
      tex/                      textures

Pourquoi un payload et pas une reference : le payload se **decharge**, ce qui est tout
l'interet d'une bibliotheque d'assets — une scene de plan peut ouvrir cinquante assets sans
charger leur geometrie. Pourquoi des sous-couches et pas un fichier unique : la geometrie et
le look sont produits par deux personnes differentes, chacune ecrit dans sa couche.

Les fichiers sont ecrits en `.usda` (texte) : un graphe de demonstration doit pouvoir
s'ouvrir dans un editeur. Seule la geometrie reste en `.usdc` binaire, comme en production.

Usage : python build_usd_asset.py <spec.json>
Ecrit une ligne `SAMPLE_USD_JSON {...}` : chemins ecrits, variantSets, purposes, prims.
"""

import json
import os
import sys

MARKER = "SAMPLE_USD_JSON"

HEADER = """#usda 1.0
(
    defaultPrim = "{name}"
    metersPerUnit = 1
    upAxis = "Y"
    doc = \"\"\"{doc}\"\"\"
)
"""


def _texture_shader(ident, path, colorspace, scale=None, bias=None, output="rgb"):
    """Un noeud UsdUVTexture, lie au lecteur d'UV de l'asset."""
    lines = [
        '        def Shader "%s"' % ident,
        "        {",
        '            uniform token info:id = "UsdUVTexture"',
        "            asset inputs:file = @%s@" % path,
        '            token inputs:wrapS = "repeat"',
        '            token inputs:wrapT = "repeat"',
        '            token inputs:sourceColorSpace = "%s"' % colorspace,
        "            float2 inputs:st.connect = </{name}/mtl/stReader.outputs:result>",
    ]
    if scale:
        lines.append("            float4 inputs:scale = (%s)" % ", ".join("%g" % v for v in scale))
    if bias:
        lines.append("            float4 inputs:bias = (%s)" % ", ".join("%g" % v for v in bias))
    if output == "rgb":
        lines.append("            float3 outputs:rgb")
    else:
        lines.append("            float outputs:r")
        lines.append("            float outputs:g")
        lines.append("            float outputs:b")
    lines.append("        }")
    return "\n".join(lines)


def _material(name, look, textures):
    """Un Material complet : surface UsdPreviewSurface alimentee par les textures PBR."""
    tint = look.get("tint", [1, 1, 1, 1])
    rough = look.get("roughnessScale", 1.0)
    ident = look["name"]
    blocks = [
        '    def Material "%s"' % ident,
        "    {",
        "        token outputs:surface.connect = </{name}/mtl/%s/surface.outputs:surface>" % ident,
        "",
        '        def Shader "surface"',
        "        {",
        '            uniform token info:id = "UsdPreviewSurface"',
        "            float inputs:metallic.connect = </{name}/mtl/%s/armTex.outputs:b>" % ident,
        "            float inputs:roughness.connect = </{name}/mtl/%s/armTex.outputs:g>" % ident,
        "            float inputs:occlusion.connect = </{name}/mtl/%s/armTex.outputs:r>" % ident,
        "            color3f inputs:diffuseColor.connect = </{name}/mtl/%s/diffTex.outputs:rgb>" % ident,
        "            normal3f inputs:normal.connect = </{name}/mtl/%s/normTex.outputs:rgb>" % ident,
        "            float inputs:opacity = 1",
        "            int inputs:useSpecularWorkflow = 0",
        "            token outputs:surface",
        "        }",
        "",
        _texture_shader("diffTex", textures["diffuse"], "sRGB", scale=tint),
        "",
        _texture_shader(
            "normTex",
            textures["normal"],
            "raw",
            scale=[2, 2, 2, 1],
            bias=[-1, -1, -1, 0],
        ),
        "",
        _texture_shader(
            "armTex",
            textures["arm"],
            "raw",
            scale=[1, rough, 1, 1],
            output="channels",
        ),
        "    }",
    ]
    return "\n".join(blocks).replace("{name}", name)


def write_material_library(spec, path):
    """`mtl/<Nom>_mtl.usda` — la bibliotheque de looks, une couche a elle seule."""
    name = spec["name"]
    body = [
        HEADER.format(name=name, doc="Material library — %s (sample project)" % name),
        "",
        'over "%s"' % name,
        "{",
        '    def Scope "mtl"',
        "    {",
        '        def Shader "stReader"',
        "        {",
        '            uniform token info:id = "UsdPrimvarReader_float2"',
        '            token inputs:varname = "st"',
        "            float2 outputs:result",
        "        }",
        "",
    ]
    for look in spec["looks"]:
        body.append(_material(name, look, spec["textures"]))
        body.append("")
    body += ["    }", "}", ""]
    _write(path, "\n".join(body))


def write_binding_layer(spec, path):
    """`mtl/<Nom>_bind.usda` — purposes et liaison par defaut, separes des materiaux."""
    name = spec["name"]
    default_look = spec["looks"][0]["name"]
    body = [
        HEADER.format(name=name, doc="Purposes and default material binding — %s" % name),
        "",
        'over "%s"' % name,
        "{",
        '    over "geom"',
        "    {",
    ]
    for purpose in ("render", "proxy"):
        body += [
            '        over "%s" (' % purpose,
            '            prepend apiSchemas = ["MaterialBindingAPI"]',
            "        )",
            "        {",
            '            uniform token purpose = "%s"' % purpose,
            "            rel material:binding = </%s/mtl/%s>" % (name, default_look),
            "        }",
        ]
    body += ["    }", "}", ""]
    _write(path, "\n".join(body))


def write_payload(spec, path):
    """`<Nom>_payload.usda` — assemble les couches et porte les variantes de look."""
    name = spec["name"]
    sublayers = [
        "./mtl/%s_bind.usda" % name,
        "./mtl/%s_mtl.usda" % name,
        "./geom/%s" % os.path.basename(spec["geom"]["render"]),
        "./geom/%s" % os.path.basename(spec["geom"]["proxy"]),
    ]
    head = [
        "#usda 1.0",
        "(",
        '    defaultPrim = "%s"' % name,
        "    metersPerUnit = 1",
        '    upAxis = "Y"',
        "    subLayers = [",
        "        %s" % ",\n        ".join("@%s@" % layer for layer in sublayers),
        "    ]",
        "    doc = \"\"\"Payload — %s. Sub-layers are ordered strongest first: binding wins over" % name,
        'the material library, which wins over geometry."""',
        ")",
        "",
        'def Xform "%s" (' % name,
        '    prepend variantSets = "lookVariant"',
        '    variants = { string lookVariant = "%s" }' % spec["looks"][0]["name"],
        ")",
        "{",
        '    variantSet "lookVariant" = {',
    ]
    for look in spec["looks"]:
        head += [
            '        "%s" {' % look["name"],
            '            over "geom" {',
        ]
        for purpose in ("render", "proxy"):
            head += [
                '                over "%s" (' % purpose,
                '                    prepend apiSchemas = ["MaterialBindingAPI"]',
                "                )",
                "                {",
                "                    rel material:binding = </%s/mtl/%s>" % (name, look["name"]),
                "                }",
            ]
        head += ["            }", "        }", ""]
    head += ["    }", "}", ""]
    _write(path, "\n".join(head))


def write_interface(spec, path):
    """`<Nom>.usda` — ce que les plans referencent : une interface, pas un contenu."""
    name = spec["name"]
    body = [
        "#usda 1.0",
        "(",
        '    defaultPrim = "%s"' % name,
        "    metersPerUnit = 1",
        '    upAxis = "Y"',
        '    doc = """Asset interface — %s. Shots reference THIS file; the payload keeps' % name,
        'their stage light until the geometry is actually needed."""',
        ")",
        "",
        'def Xform "%s" (' % name,
        '    kind = "component"',
        "    assetInfo = {",
        '        string name = "%s"' % name,
        '        string version = "%s"' % spec.get("version", "v001"),
        '        asset identifier = @./%s.usda@' % name,
        "    }",
        "    prepend payload = @./%s_payload.usda@</%s>" % (name, name),
        ")",
        "{",
        "}",
        "",
    ]
    _write(path, "\n".join(body))


def _write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)


def inspect(root):
    """Relit le graphe assemble : c'est la seule preuve que la composition tient."""
    from pxr import Usd, UsdGeom

    stage = Usd.Stage.Open(root)
    if not stage:
        raise SystemExit("stage illisible: %s" % root)
    variant_sets = []
    purposes = set()
    prims = 0
    for prim in stage.TraverseAll():
        prims += 1
        for set_name in prim.GetVariantSets().GetNames():
            variant_sets.append(
                {
                    "prim": str(prim.GetPath()),
                    "name": set_name,
                    "options": list(prim.GetVariantSets().GetVariantSet(set_name).GetVariantNames()),
                }
            )
        imageable = UsdGeom.Imageable(prim)
        if imageable:
            value = imageable.GetPurposeAttr().Get()
            if value:
                purposes.add(str(value))
    return {
        "root": root,
        "defaultPrim": str(stage.GetDefaultPrim().GetPath()) if stage.GetDefaultPrim() else None,
        "variantSets": variant_sets,
        "purposes": sorted(purposes),
        "prims": prims,
    }


def main():
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        spec = json.load(handle)
    asset_dir = spec["assetDir"]
    name = spec["name"]

    write_material_library(spec, os.path.join(asset_dir, "mtl", "%s_mtl.usda" % name))
    write_binding_layer(spec, os.path.join(asset_dir, "mtl", "%s_bind.usda" % name))
    write_payload(spec, os.path.join(asset_dir, "%s_payload.usda" % name))
    root = os.path.join(asset_dir, "%s.usda" % name)
    write_interface(spec, root)

    print("%s %s" % (MARKER, json.dumps(inspect(root))))


main()
