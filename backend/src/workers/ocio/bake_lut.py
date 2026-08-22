#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Cuisson d'une LUT 3D d'affichage a partir d'une config OCIO (ReView).

Ce script est la voie **exacte** du produit : il demande a OpenColorIO le processeur
`espace d'entree -> (display, view)` de la config du studio, l'applique a une grille
reguliere, et ecrit un `.cube` (Iridas/Resolve) que le viewer WebGL echantillonne tel quel.
Il couvre donc aussi les vues tone-mappees (RRT + ODT ACES), que le repli TypeScript
(`backend/src/lib/ocioBake.ts`) refuse volontairement d'approcher.

Dependance : PyOpenColorIO (roue PyPI `opencolorio`, BSD-3-Clause). Elle n'est pas dans
l'image par defaut ; l'ajouter au venv deja present pour l'USD :

    /opt/usdenv/bin/pip install --no-cache-dir opencolorio

Convention de domaine (celle du viewer) : l'entree de la LUT est le **code d'entree encode
dans [0,1]** (par defaut l'espace texture sRGB, ce que contient un JPEG/PNG de review) et la
sortie est le **code d'affichage**. Le rouge varie le plus vite, comme le veut le format.

Sortie : le fichier `--out`, plus une ligne `REVIEW_OCIO_JSON {...}` sur stdout (le reste du
bruit eventuel d'OCIO part sur stderr).
"""

import argparse
import array
import json
import sys

MARKER = "REVIEW_OCIO_JSON"
MAX_SIZE = 65


def build_grid(size):
    """Grille reguliere [0,1]^3, rouge variant le plus vite (ordre .cube)."""
    values = array.array("f", bytes(4 * size * size * size * 3))
    last = float(size - 1)
    i = 0
    for b in range(size):
        for g in range(size):
            for r in range(size):
                values[i] = r / last
                values[i + 1] = g / last
                values[i + 2] = b / last
                i += 3
    return values


def write_cube(path, values, size, title, source):
    with open(path, "w", encoding="utf-8") as fh:
        # Meme forme que `CUBE_SOURCE_PREFIX` dans backend/src/lib/ocioBake.ts : le viewer
        # relit cette ligne pour afficher la provenance de la transformee.
        fh.write("# ReView display transform | source: %s\n" % source)
        fh.write('TITLE "%s"\n' % title.replace('"', "").replace("\n", " "))
        fh.write("LUT_3D_SIZE %d\n" % size)
        fh.write("DOMAIN_MIN 0.0 0.0 0.0\n")
        fh.write("DOMAIN_MAX 1.0 1.0 1.0\n")
        for i in range(0, len(values), 3):
            fh.write("%.6f %.6f %.6f\n" % (values[i], values[i + 1], values[i + 2]))


def main():
    ap = argparse.ArgumentParser(description="Bake an OCIO display/view into a 3D .cube LUT")
    ap.add_argument("--config", required=True)
    ap.add_argument("--display", required=True)
    ap.add_argument("--view", required=True)
    ap.add_argument("--inputspace", required=True)
    ap.add_argument("--size", type=int, default=33)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    if args.size < 2 or args.size > MAX_SIZE:
        sys.stderr.write("size out of range (2..%d)\n" % MAX_SIZE)
        return 2

    import PyOpenColorIO as ocio  # noqa: N813 (nom impose par le paquet)

    config = ocio.Config.CreateFromFile(args.config)

    displays = list(config.getDisplays())
    if args.display not in displays:
        sys.stderr.write("unknown display %r (have: %s)\n" % (args.display, ", ".join(displays)))
        return 3
    views = list(config.getViews(args.display))
    if args.view not in views:
        sys.stderr.write("unknown view %r (have: %s)\n" % (args.view, ", ".join(views)))
        return 3

    # `--inputspace` porte plusieurs candidats separes par ';' : les configs ACES ont renomme
    # l'espace texture sRGB d'une generation a l'autre. On retient le premier qui existe.
    known = set(config.getColorSpaceNames())
    candidates = [c for c in args.inputspace.split(";") if c]
    inputspace = next((c for c in candidates if c in known), None)
    if inputspace is None:
        sys.stderr.write("no input colorspace among %s\n" % ", ".join(candidates))
        return 4

    processor = config.getProcessor(
        inputspace, args.display, args.view, ocio.TRANSFORM_DIR_FORWARD
    )
    cpu = processor.getDefaultCPUProcessor()

    values = build_grid(args.size)
    cpu.applyRGB(values)
    # Le viewer echantillonne un code d'affichage : on borne, comme le ferait l'ecran.
    for i, v in enumerate(values):
        if v < 0.0:
            values[i] = 0.0
        elif v > 1.0:
            values[i] = 1.0

    write_cube(
        args.out,
        values,
        args.size,
        "%s / %s" % (args.display, args.view),
        "OpenColorIO %s" % ocio.GetVersion(),
    )
    sys.stdout.write(
        "%s %s\n"
        % (
            MARKER,
            json.dumps(
                {
                    "display": args.display,
                    "view": args.view,
                    "input": inputspace,
                    "size": args.size,
                    "ocio": ocio.GetVersion(),
                }
            ),
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
