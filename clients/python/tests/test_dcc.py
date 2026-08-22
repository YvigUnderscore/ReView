# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Naming convention → pipeline path. The part of a DCC add-on that can be tested."""

from __future__ import annotations

import os
import unittest

from review.dcc import guess_pipeline_path


class GuessPipelinePath(unittest.TestCase):
    def test_reads_sequence_shot_and_step(self) -> None:
        self.assertEqual(
            guess_pipeline_path("/renders/SQ010_SH0100_anim_v003.mov", project="PROJ"),
            "PROJ/SQ010/SH0100/anim",
        )

    def test_ignores_the_version_token_the_server_decides(self) -> None:
        without = guess_pipeline_path("/renders/SQ010_SH0100_anim.mov", project="PROJ")
        self.assertEqual(without, guess_pipeline_path("/renders/SQ010_SH0100_anim_V12.exr", project="PROJ"))

    def test_a_shot_with_no_sequence_takes_the_reserved_branch(self) -> None:
        self.assertEqual(
            guess_pipeline_path("SH0100_comp_v001.mov", project="PROJ"),
            "PROJ/shots/SH0100/comp",
        )

    def test_the_caller_can_impose_the_step(self) -> None:
        self.assertEqual(
            guess_pipeline_path("SQ010_SH0100_anim_v003.mov", project="PROJ", task="comp"),
            "PROJ/SQ010/SH0100/comp",
        )

    def test_a_studio_can_change_the_separator(self) -> None:
        self.assertEqual(
            guess_pipeline_path("SQ010-SH0100-layout.mov", project="PROJ", separator="-"),
            "PROJ/SQ010/SH0100/layout",
        )

    # Publier dans le mauvais plan ne se rattrape pas : mieux vaut ne rien deviner.
    def test_says_nothing_rather_than_guessing_wrong(self) -> None:
        self.assertIsNone(guess_pipeline_path("render.mov", project="PROJ"))
        self.assertIsNone(guess_pipeline_path("SQ010_SH0100_anim.mov"))

    def test_the_show_comes_from_the_session(self) -> None:
        previous = os.environ.get("REVIEW_PROJECT")
        os.environ["REVIEW_PROJECT"] = "OTHER"
        try:
            self.assertEqual(
                guess_pipeline_path("SQ010_SH0100_anim.mov"),
                "OTHER/SQ010/SH0100/anim",
            )
        finally:
            os.environ.pop("REVIEW_PROJECT", None) if previous is None else os.environ.update(
                {"REVIEW_PROJECT": previous}
            )


if __name__ == "__main__":  # pragma: no cover - manual run
    unittest.main()
