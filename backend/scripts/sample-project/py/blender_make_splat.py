# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Fabrication d'un Gaussian Splat a partir d'un scan photogrammetrique CC0.

Le projet de demonstration doit montrer le viewer splat avec de **vrais** fichiers, sans
emprunter les scenes d'entrainement des articles de recherche : leurs modeles entraines
sont diffuses pour la recherche seule et n'ont donc pas leur place dans un jeu de
demonstration libre.

Le procede est celui d'un « surfel splatting » : on echantillonne la surface d'un scan
Poly Haven (CC0, photogrammetrie), on lit la couleur dans sa texture diffuse, et on ecrit
une gaussienne par point — aplatie selon la normale et etiree dans le plan tangent. Le
resultat est un fichier 3DGS parfaitement standard (meme jeu de proprietes que la sortie de
l'implementation de reference), lisible par Spark comme par tout autre viewer.

Usage (Blender headless) :
    blender --background --python blender_make_splat.py -- --input scan.gltf \
        --output scene.ply --count 220000 [--scale 1.0] [--jitter 0.35]

Ecrit une ligne `SAMPLE_SPLAT_JSON {...}` sur stdout.
"""

import json
import os
import sys

import bmesh
import bpy
import numpy as np

MARKER = "SAMPLE_SPLAT_JSON"

# Coefficient de l'harmonique spherique d'ordre 0 : c'est par lui que passe la couleur de
# base d'un splat (`f_dc`), exactement comme dans l'implementation de reference.
SH_C0 = 0.28209479177387814


def _argv():
    argv = sys.argv
    return argv[argv.index("--") + 1 :] if "--" in argv else []


def _parse(args):
    out = {"count": 200000, "scale": 1.0, "jitter": 0.35, "opacity": 0.94}
    key = None
    for token in args:
        if token.startswith("--"):
            key = token[2:]
            out.setdefault(key, True)
        elif key:
            out[key] = token
            key = None
    for numeric in ("count",):
        out[numeric] = int(out[numeric])
    for numeric in ("scale", "jitter", "opacity"):
        out[numeric] = float(out[numeric])
    return out


def _load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def _triangulate(obj):
    """Copie triangulee et evaluee (modificateurs compris) du maillage."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
    mesh.transform(obj.matrix_world)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    mesh.calc_loop_triangles()
    return mesh


def _texture_of(obj):
    """Image de couleur de base du premier materiau — la seule dont un splat a besoin."""
    for slot in obj.material_slots:
        material = slot.material
        if not material or not material.use_nodes:
            continue
        for node in material.node_tree.nodes:
            if node.type == "BSDF_PRINCIPLED":
                link = node.inputs["Base Color"].links
                if link and link[0].from_node.type == "TEX_IMAGE":
                    return link[0].from_node.image
        for node in material.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image:
                return node.image
    return None


def _image_array(image):
    """Pixels de l'image en tableau (h, w, 4), float 0..1."""
    width, height = image.size
    if width == 0 or height == 0:
        return None
    buffer = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(buffer)
    return buffer.reshape(height, width, 4)


def _sample_mesh(mesh, count, rng):
    """Points repartis sur la surface, ponderes par l'aire des triangles."""
    triangles = mesh.loop_triangles
    if not triangles:
        return None
    tri_count = len(triangles)

    verts = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get("co", verts)
    verts = verts.reshape(-1, 3)

    indices = np.empty(tri_count * 3, dtype=np.int32)
    triangles.foreach_get("vertices", indices)
    indices = indices.reshape(-1, 3)

    normals = np.empty(tri_count * 3, dtype=np.float32)
    triangles.foreach_get("normal", normals)
    normals = normals.reshape(-1, 3)

    uv_layer = mesh.uv_layers.active
    uvs = None
    if uv_layer:
        loops = np.empty(tri_count * 3, dtype=np.int32)
        triangles.foreach_get("loops", loops)
        all_uv = np.empty(len(mesh.loops) * 2, dtype=np.float32)
        # `uv` est une collection d'attributs : la valeur se lit par son nom de champ.
        uv_layer.uv.foreach_get("vector", all_uv)
        uvs = all_uv.reshape(-1, 2)[loops.reshape(-1, 3)]

    a, b, c = verts[indices[:, 0]], verts[indices[:, 1]], verts[indices[:, 2]]
    areas = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    total = float(areas.sum())
    if total <= 0:
        return None
    picks = rng.choice(tri_count, size=count, p=areas / total)

    # Coordonnees barycentriques uniformes sur un triangle.
    r1 = np.sqrt(rng.random(count, dtype=np.float32))
    r2 = rng.random(count, dtype=np.float32)
    w0 = (1.0 - r1)[:, None]
    w1 = (r1 * (1.0 - r2))[:, None]
    w2 = (r1 * r2)[:, None]

    points = w0 * a[picks] + w1 * b[picks] + w2 * c[picks]
    point_normals = normals[picks]
    point_uvs = None
    if uvs is not None:
        point_uvs = w0 * uvs[picks, 0] + w1 * uvs[picks, 1] + w2 * uvs[picks, 2]
    spacing = float(np.sqrt(total / max(count, 1)))
    return points, point_normals, point_uvs, spacing


def _colours(uvs, image_array, count, rng):
    """Couleur de chaque point, lue dans la texture (repli : gris legerement bruite)."""
    if uvs is None or image_array is None:
        base = np.full((count, 3), 0.55, dtype=np.float32)
        return base + rng.normal(0, 0.03, (count, 3)).astype(np.float32)
    height, width = image_array.shape[0], image_array.shape[1]
    xs = np.clip((uvs[:, 0] % 1.0) * (width - 1), 0, width - 1).astype(np.int32)
    ys = np.clip((uvs[:, 1] % 1.0) * (height - 1), 0, height - 1).astype(np.int32)
    return image_array[ys, xs, :3].astype(np.float32)


def _quaternions(normals):
    """Rotation amenant l'axe Z local sur la normale : la gaussienne epouse la surface."""
    n = normals / np.clip(np.linalg.norm(normals, axis=1, keepdims=True), 1e-8, None)
    z = np.zeros_like(n)
    z[:, 2] = 1.0
    dot = np.clip((z * n).sum(axis=1), -1.0, 1.0)
    axis = np.cross(z, n)
    axis_len = np.linalg.norm(axis, axis=1, keepdims=True)
    # Normale opposee a Z : rotation d'un demi-tour autour d'un axe orthogonal quelconque.
    fallback = np.tile(np.array([1.0, 0.0, 0.0], dtype=np.float32), (len(n), 1))
    axis = np.where(axis_len < 1e-6, fallback, axis / np.clip(axis_len, 1e-8, None))
    angle = np.arccos(dot)
    half = angle / 2.0
    quat = np.empty((len(n), 4), dtype=np.float32)
    quat[:, 0] = np.cos(half)
    quat[:, 1:] = axis * np.sin(half)[:, None]
    return quat


PROPERTIES = (
    ["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2", "opacity"]
    + ["scale_0", "scale_1", "scale_2"]
    + ["rot_0", "rot_1", "rot_2", "rot_3"]
)


def _write_ply(path, data):
    header = ["ply", "format binary_little_endian 1.0", "element vertex %d" % len(data)]
    header += ["property float %s" % name for name in PROPERTIES]
    header += ["end_header", ""]
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "wb") as handle:
        handle.write("\n".join(header).encode("ascii"))
        handle.write(data.astype("<f4").tobytes())


def main():
    opts = _parse(_argv())
    rng = np.random.default_rng(20260829)
    meshes = _load(opts["input"])
    if not meshes:
        raise SystemExit("no mesh in %s" % opts["input"])

    per_mesh = max(1, opts["count"] // len(meshes))
    rows = []
    for obj in meshes:
        mesh = _triangulate(obj)
        sampled = _sample_mesh(mesh, per_mesh, rng)
        if not sampled:
            continue
        points, normals, uvs, spacing = sampled
        image = _texture_of(obj)
        colours = _colours(uvs, _image_array(image) if image else None, len(points), rng)

        # Bruit tangentiel : une capture n'a jamais des centres parfaitement sur la surface.
        points = points + normals * rng.normal(0, spacing * opts["jitter"] * 0.25, (len(points), 1)).astype(
            np.float32
        )
        points *= opts["scale"]

        block = np.empty((len(points), len(PROPERTIES)), dtype=np.float32)
        block[:, 0:3] = points
        block[:, 3:6] = normals
        block[:, 6:9] = (colours - 0.5) / SH_C0
        block[:, 9] = np.log(opts["opacity"] / (1.0 - opts["opacity"]))
        tangent = spacing * opts["scale"] * 0.85
        block[:, 10] = np.log(tangent)
        block[:, 11] = np.log(tangent)
        block[:, 12] = np.log(tangent * 0.22)
        block[:, 13:17] = _quaternions(normals)
        rows.append(block)
        bpy.data.meshes.remove(mesh)

    data = np.concatenate(rows, axis=0)
    _write_ply(opts["output"], data)
    print(
        "%s %s"
        % (
            MARKER,
            json.dumps(
                {
                    "output": opts["output"],
                    "splats": int(len(data)),
                    "bytes": os.path.getsize(opts["output"]),
                }
            ),
        )
    )


main()
