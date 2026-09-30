# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Blender add-on — « Publish to ReView », in Properties ▸ Output.

Install: Edit ▸ Preferences ▸ Add-ons ▸ Install…, pick this file, enable it. The add-on
needs the ``review`` package on ``PYTHONPATH`` (``clients/python``) and two environment
variables set by the studio launcher:

    REVIEW_URL=https://review.mystudio.com
    REVIEW_TOKEN=rvk_…
    REVIEW_PROJECT=PROJ            # the show, so the filename need not carry it

It publishes the file Blender rendered — the movie of ``scene.render.filepath`` — at the
pipeline path guessed from the .blend name (``SQ010_SH0100_anim_v003.blend``), which the
panel lets you correct before publishing.
"""

bl_info = {
    "name": "Publish to ReView",
    "author": "Yvig Bidon",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "location": "Properties ▸ Output ▸ ReView",
    "description": "Publish the rendered movie to a ReView pipeline path",
    "category": "Import-Export",
}

import os

import bpy

from review import ReviewApiError, ReviewClient, ReviewError
from review.dcc import guess_pipeline_path


def _default_path() -> str:
    return guess_pipeline_path(bpy.data.filepath or "", task="anim") or ""


def _rendered_movie(scene: "bpy.types.Scene") -> str:
    """The file Blender wrote. A movie output is a single file; a sequence is not."""
    return bpy.path.abspath(scene.render.frame_path(frame=scene.frame_start))


class REVIEW_OT_publish(bpy.types.Operator):
    """Send the rendered movie to ReView"""

    bl_idname = "review.publish"
    bl_label = "Publish to ReView"

    def execute(self, context):  # noqa: D102 - Blender's own contract
        scene = context.scene
        pipeline_path = scene.review_path or _default_path()
        movie = bpy.path.abspath(scene.review_file) if scene.review_file else _rendered_movie(scene)
        if not pipeline_path:
            self.report({"ERROR"}, "No pipeline path: fill the ReView panel")
            return {"CANCELLED"}
        if not os.path.isfile(movie):
            self.report({"ERROR"}, f"Nothing rendered at {movie}")
            return {"CANCELLED"}
        try:
            result = ReviewClient().publish(
                pipeline_path,
                movie,
                start_frame=scene.frame_start,
                end_frame=scene.frame_end,
            )
        except ReviewApiError as exc:
            self.report({"ERROR"}, f"{exc.code}: {exc.message}")
            return {"CANCELLED"}
        except ReviewError as exc:
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}
        self.report({"INFO"}, f"Published {result.version_path or result.media_id}")
        return {"FINISHED"}


class REVIEW_PT_panel(bpy.types.Panel):
    bl_label = "ReView"
    bl_space_type = "PROPERTIES"
    bl_region_type = "WINDOW"
    bl_context = "output"

    def draw(self, context):  # noqa: D102 - Blender's own contract
        layout = self.layout
        scene = context.scene
        column = layout.column()
        column.prop(scene, "review_path", text="Path")
        column.prop(scene, "review_file", text="File")
        if not (scene.review_path or _default_path()):
            column.label(text="Set REVIEW_PROJECT or type a path", icon="ERROR")
        column.operator(REVIEW_OT_publish.bl_idname, icon="EXPORT")


CLASSES = (REVIEW_OT_publish, REVIEW_PT_panel)


def register() -> None:
    bpy.types.Scene.review_path = bpy.props.StringProperty(
        name="ReView path",
        description="Pipeline path, e.g. PROJ/SQ010/SH0100/anim (empty: guessed from the .blend name)",
        default="",
    )
    bpy.types.Scene.review_file = bpy.props.StringProperty(
        name="File",
        description="File to publish (empty: the movie of the render output)",
        default="",
        subtype="FILE_PATH",
    )
    for cls in CLASSES:
        bpy.utils.register_class(cls)


def unregister() -> None:
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
    del bpy.types.Scene.review_path
    del bpy.types.Scene.review_file


if __name__ == "__main__":
    register()
