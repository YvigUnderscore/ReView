# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Nuke integration — publish a Write node's output to ReView.

Install: copy this file next to your ``menu.py`` (a folder listed in ``NUKE_PATH``) and
add one line to ``menu.py``::

    import nuke_review_publish  # registers the ReView menu and the afterRender hook

It needs the ``review`` package on ``PYTHONPATH`` (``clients/python``) and the studio
environment: ``REVIEW_URL``, ``REVIEW_TOKEN``, ``REVIEW_PROJECT``.

Two ways to publish:

* **manually** — select a Write node, ReView ▸ Publish selected Write (``Ctrl+Alt+P``);
* **automatically** — tick ``Publish to ReView`` on the Write node (the knob is added on
  demand by the menu command below), and every render publishes when it finishes.

The pipeline path comes from the Write node's ``review_path`` knob when it has one, else
it is guessed from the rendered filename (``SQ010_SH0100_comp_v003.mov``).
"""

import os

import nuke

from review import ReviewApiError, ReviewClient, ReviewError
from review.dcc import guess_pipeline_path

PATH_KNOB = "review_path"
AUTO_KNOB = "review_auto"


def _rendered_file(node):
    """The file the Write node just produced, frame-substituted by Nuke itself."""
    return nuke.filename(node, nuke.REPLACE)


def _pipeline_path(node, rendered):
    knob = node.knob(PATH_KNOB)
    typed = knob.value().strip() if knob else ""
    return typed or guess_pipeline_path(rendered or "", task="comp") or ""


def publish_node(node=None, notify=True):
    """Publish one Write node's output. Returns the version path, or ``None``."""
    node = node or nuke.thisNode()
    rendered = _rendered_file(node)
    pipeline_path = _pipeline_path(node, rendered)
    if not rendered or not os.path.isfile(rendered):
        _say(f"ReView: nothing rendered for {node.name()}", notify)
        return None
    if not pipeline_path:
        _say("ReView: no pipeline path — set the review_path knob", notify)
        return None
    try:
        result = ReviewClient().publish(
            pipeline_path,
            rendered,
            start_frame=int(node.firstFrame()),
            end_frame=int(node.lastFrame()),
        )
    except ReviewApiError as exc:
        _say(f"ReView refused: {exc.code} — {exc.message}", notify)
        return None
    except ReviewError as exc:
        _say(f"ReView: {exc}", notify)
        return None
    _say(f"ReView: published {result.version_path or result.media_id}", notify)
    return result.version_path


def publish_selected():
    """Menu command: publish the selected Write nodes, adding the knobs on first use."""
    for node in nuke.selectedNodes("Write") or []:
        add_knobs(node)
        publish_node(node)


def add_knobs(node):
    """Give a Write node its two ReView knobs, once."""
    if not node.knob(PATH_KNOB):
        knob = nuke.String_Knob(PATH_KNOB, "ReView path")
        knob.setTooltip("PROJ/SQ010/SH0100/comp — empty: guessed from the rendered filename")
        node.addKnob(knob)
    if not node.knob(AUTO_KNOB):
        node.addKnob(nuke.Boolean_Knob(AUTO_KNOB, "Publish to ReView", False))


def _after_render():
    """afterRender hook — silent unless the artist asked for the publish."""
    node = nuke.thisNode()
    knob = node.knob(AUTO_KNOB)
    if knob and knob.value():
        publish_node(node, notify=False)


def _say(message, notify):
    if notify and hasattr(nuke, "message"):
        nuke.message(message)
    else:
        # En rendu de ferme, une boîte de dialogue bloquerait le nœud : on écrit au log.
        nuke.tprint(message)


def register():
    menu = nuke.menu("Nuke").addMenu("ReView")
    menu.addCommand("Publish selected Write", publish_selected, "ctrl+alt+p")
    menu.addCommand("Add ReView knobs", lambda: [add_knobs(n) for n in nuke.selectedNodes("Write")])
    nuke.addAfterRender(_after_render, nodeClass="Write")


register()
