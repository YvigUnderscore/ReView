#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Bake a 3D display LUT from an OCIO config (ReView).

This script is the product's **exact** path: it asks OpenColorIO for the processor
`input space -> (display, view)` of the studio config, applies it to a regular grid,
and writes a `.cube` (Iridas/Resolve) that the WebGL viewer samples as is.
It therefore also covers tone-mapped views (ACES RRT + ODT), which the TypeScript
fallback (`backend/src/lib/ocioBake.ts`) deliberately refuses to approximate.

Dependency: PyOpenColorIO (PyPI wheel `opencolorio`, BSD-3-Clause). It is not in the
default image; add it to the venv already present for USD:

    /opt/usdenv/bin/pip install --no-cache-dir opencolorio

Domain convention (the viewer's): the LUT input is the **encoded input code in
[0,1]** (by default the sRGB texture space, which is what a review JPEG/PNG contains) and
the output is the **display code**. Red varies the fastest, as the format requires.

Output: the `--out` file, plus a `REVIEW_OCIO_JSON {...}` line on stdout (any remaining
OCIO noise goes to stderr).
"""

import argparse
import array
import json
import sys

MARKER = "REVIEW_OCIO_JSON"
MAX_SIZE = 65


def build_grid(size):
    """Regular [0,1]^3 grid, red varying the fastest (.cube order)."""
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
        # Same shape as `CUBE_SOURCE_PREFIX` in backend/src/lib/ocioBake.ts: the viewer
        # re-reads this line to display the provenance of the transform.
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

    # `--inputspace` takes several candidates separated by ';': ACES configs renamed
    # the sRGB texture space from one generation to the next. We keep the first one that exists.
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
    # The viewer samples a display code: we clamp it, as the screen would.
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
