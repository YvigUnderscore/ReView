# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Turning what a DCC knows into what ReView addresses.

A DCC knows a file on disk; ReView addresses a **pipeline path**
(``PROJ/SQ010/SH0100/anim``). Every studio names its files differently, so this module
holds one convention — the common ``SQ010_SH0100_anim_v003.ext`` — as a *pure function*,
away from ``bpy`` and ``nuke``. Two consequences: it is unit-tested, and a studio whose
naming differs replaces this single function instead of forking two add-ons.
"""

from __future__ import annotations

import os
import re

VERSION_TOKEN = re.compile(r"^v\d+$", re.IGNORECASE)


def _tokens(filepath: str, separator: str) -> list[str]:
    stem = os.path.splitext(os.path.basename(filepath))[0]
    parts = [part for part in stem.split(separator) if part]
    # « …_v003 » nomme la version, pas une étape : la version est décidée par le serveur.
    return parts[:-1] if parts and VERSION_TOKEN.match(parts[-1]) else parts


def guess_pipeline_path(
    filepath: str,
    *,
    project: str | None = None,
    task: str | None = None,
    separator: str = "_",
) -> str | None:
    """Guess ``PROJ/SQ010/SH0100/anim`` from ``…/SQ010_SH0100_anim_v003.mov``.

    ``project`` falls back to ``$REVIEW_PROJECT``: the show is a property of the session,
    never of the filename. Returns ``None`` when the name says too little — the caller
    then asks the artist rather than publishing to a wrong shot, which no one can undo.

    Two shapes are recognised, plus ``task`` as an override:

    * ``SQ010_SH0100_anim`` → ``PROJ/SQ010/SH0100/anim``
    * ``SH0100_anim`` → ``PROJ/shots/SH0100/anim`` (a shot with no sequence)
    """
    show = (project or os.environ.get("REVIEW_PROJECT", "")).strip()
    if not show:
        return None
    parts = _tokens(filepath, separator)
    if len(parts) >= 3:
        sequence, shot, step = parts[0], parts[1], task or parts[2]
        return f"{show}/{sequence}/{shot}/{step}"
    if len(parts) == 2:
        shot, step = parts[0], task or parts[1]
        return f"{show}/shots/{shot}/{step}"
    if len(parts) == 1 and task:
        return f"{show}/shots/{parts[0]}/{task}"
    return None
