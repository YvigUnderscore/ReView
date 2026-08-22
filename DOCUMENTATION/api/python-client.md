# Python client & DCC integrations

> Updated: 2026-08-22

The repository ships a client for the [v1 API](v1-integration.md) in
[`clients/python/`](../../clients/python/README.md), and two thin integrations built on it
in [`clients/dcc/`](../../clients/dcc/). They are AGPL-3.0-or-later like the rest of
ReView, and depend on **nothing outside the Python standard library** — a farm node or a
DCC interpreter cannot be asked to `pip install` anything.

## Install on a workstation

Put the folder on `PYTHONPATH` and set the studio environment; a launcher usually does
both:

```bash
export PYTHONPATH="/mnt/pipeline/ReView-app/clients/python:$PYTHONPATH"
export REVIEW_URL="https://review.mystudio.com"
export REVIEW_TOKEN="rvk_0123456789abcdef0123456789abcdef01234567"
export REVIEW_PROJECT="PROJ"          # used to guess pipeline paths from filenames

python -m review whoami
# farm-publisher@service.review.invalid (ARTIST) via api_token
```

Where a package can be installed, `pip install -e clients/python` also provides a
`review` command. Issue the token as a **service token bound to the project** — see
[Authentication & API access](authentication.md#api-tokens): a token that leaks off a
render node then cannot touch another show, and it opens `/api/v1` only.

## Publish and read from Python

```python
from review import ReviewClient

review = ReviewClient()                       # reads REVIEW_URL / REVIEW_TOKEN

result = review.publish(
    "PROJ/SQ010/SH0100/anim",
    "/renders/PROJ/SQ010/SH0100/SH0100_anim_v001.mov",
    start_frame=1001,
    end_frame=1096,
)
print(result.version_path, result.media["status"])
# proj/SQ010/SH0100/anim/V01 PROCESSING

answer = review.latest("PROJ/SQ010/SH0100", department="comp")
plate = answer["version"]["media"][0]
review.download(plate["id"], "/tmp/" + plate["filename"])   # signs its own URL, streams

```

| Call | What it does |
|---|---|
| `publish(path, file, …)` | The three publish calls, one idempotency key, streamed upload |
| `latest(path \| task_id=…, published=, urls=, department=)` | The version a viewer would open |
| `media_url(id, variant="source"\|"proxy"\|"thumbnail")` | A presigned URL |
| `download(id, destination)` | Streams a media to disk, 1 MB at a time |
| `resolve(path)` | Pipeline path → entities |
| `me()`, `schema()` | Token powers, accepted values |
| `events(since=…)` | Event journal, by cursor |

Everything is retried on `429`/`5xx` with exponential backoff and jitter, `Retry-After`
honoured. Writes are replayed **only** when they carry an `Idempotency-Key` — which
`publish()` does, so a timeout never opens a second version. Failures raise
`ReviewApiError` (with the stable `.code`), `ReviewTransportError` or
`ReviewConfigError`; branch on `.code`, never on the message.

## Blender — a "Publish to ReView" button

Full add-on: [`clients/dcc/blender_review_publish.py`](../../clients/dcc/blender_review_publish.py).
Install it with Edit ▸ Preferences ▸ Add-ons ▸ Install…; the panel then sits in
Properties ▸ Output ▸ ReView. The core is fifteen lines — a studio that wants a different
trigger (a handler on `render_complete`, a shelf script) can start from this:

```python
# Blender 4.2+ — Text Editor ▸ Run Script, or paste into an add-on operator.
import bpy

from review import ReviewClient, ReviewError
from review.dcc import guess_pipeline_path


class REVIEW_OT_publish(bpy.types.Operator):
    """Send the rendered movie to ReView"""

    bl_idname = "review.publish"
    bl_label = "Publish to ReView"

    def execute(self, context):
        scene = context.scene
        # SQ010_SH0100_anim_v003.blend → PROJ/SQ010/SH0100/anim (PROJ from $REVIEW_PROJECT)
        path = guess_pipeline_path(bpy.data.filepath, task="anim")
        movie = bpy.path.abspath(scene.render.frame_path(frame=scene.frame_start))
        if not path:
            self.report({"ERROR"}, "Set REVIEW_PROJECT, or type the pipeline path")
            return {"CANCELLED"}
        try:
            result = ReviewClient().publish(
                path, movie, start_frame=scene.frame_start, end_frame=scene.frame_end
            )
        except ReviewError as exc:
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}
        self.report({"INFO"}, f"Published {result.version_path}")
        return {"FINISHED"}


bpy.utils.register_class(REVIEW_OT_publish)
# bpy.ops.review.publish()   ← what the panel button calls
```

Blender writes a movie only when the output format is one (FFmpeg video). For an image
sequence, publish the encoded movie your pipeline produces afterwards — ReView validates
file headers and accepts `mp4`, `mov`, `mkv`/`webm` for video.

## Nuke — publish a Write node, by hand or after every render

Full integration: [`clients/dcc/nuke_review_publish.py`](../../clients/dcc/nuke_review_publish.py).
Drop it in a folder listed in `NUKE_PATH` and add `import nuke_review_publish` to your
`menu.py`. It adds a ReView menu (`Ctrl+Alt+P` publishes the selected Write) and two knobs
on the Write node: `review_path`, and `review_auto` which publishes on every render.

```python
# menu.py — the minimal version, if you prefer to write your own.
import os

import nuke

from review import ReviewClient, ReviewError
from review.dcc import guess_pipeline_path


def publish_write():
    node = nuke.thisNode() if nuke.thisNode() else nuke.selectedNode()
    rendered = nuke.filename(node, nuke.REPLACE)
    # SQ010_SH0100_comp_v003.mov → PROJ/SQ010/SH0100/comp
    path = guess_pipeline_path(rendered or "", task="comp")
    if not path or not os.path.isfile(rendered):
        nuke.tprint("ReView: nothing to publish for %s" % node.name())
        return
    try:
        result = ReviewClient().publish(
            path, rendered, start_frame=int(node.firstFrame()), end_frame=int(node.lastFrame())
        )
    except ReviewError as exc:
        nuke.tprint("ReView: %s" % exc)
        return
    nuke.tprint("ReView: published %s" % result.version_path)


nuke.menu("Nuke").addCommand("ReView/Publish this Write", publish_write, "ctrl+alt+p")
nuke.addAfterRender(publish_write, nodeClass="Write")   # every render, every Write
```

`nuke.addAfterRender` fires on the machine that renders, farm nodes included — which is
exactly what you want, and why the token must be a service token rather than an artist's.
Drop the last line if you only want the menu command.

## Maya, Houdini, Prism

The same three lines fit anywhere a Python interpreter runs:

```python
from review import ReviewClient
ReviewClient().publish("PROJ/SQ010/SH0100/anim", playblast_path, start_frame=1001, end_frame=1096)
```

- **Maya** — a shelf button that playblasts to a temporary movie, then publishes it.
- **Houdini** — a post-render script on the ROP: `hou.node(...).parm("picture").eval()`
  gives the file, the ROP frame range gives the frames.
- **Prism / a pipeline manager** — call it from the state manager's publish hook; use
  `create_missing=False` if the manager owns the hierarchy and a missing shot must fail
  loudly rather than be created.

## Filenames → pipeline paths

`review.dcc.guess_pipeline_path` implements one convention, and only one:

| Filename | Guessed path |
|---|---|
| `SQ010_SH0100_anim_v003.mov` | `PROJ/SQ010/SH0100/anim` |
| `SH0100_comp_v001.mov` | `PROJ/shots/SH0100/comp` (a shot with no sequence) |
| `render.mov` | `None` — too little said, ask the artist |

`PROJ` comes from `$REVIEW_PROJECT` (or the `project=` argument): the show is a property
of the session, not of the filename. A trailing `_v003` is dropped — the version number
is decided by the server. Studios whose naming differs replace this single function
rather than forking the add-ons; the separator is a parameter (`separator="-"`).

The function returns `None` rather than a plausible guess when the name says too little:
publishing into the wrong shot is not something a studio can undo.

## Tests

The client is covered by `unittest` — the standard library again, because the suite must
run inside a DCC interpreter:

```bash
cd clients/python
python -m unittest discover -s . -t .
```

No socket is opened: the tests inject a fake `urllib` opener and a fake clock, so retries,
backoff and idempotency keys are asserted without waiting and without a server.

## Related pages

- [API v1 — pipeline integration](v1-integration.md) — the HTTP contract
- [Authentication & API access](authentication.md) — issuing and binding a token
- [Pipeline settings](../admin-guide/pipeline-settings.md) — what "latest" means for a shot
