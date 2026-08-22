# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""The ``review`` command line: exit codes and what a render script reads back."""

from __future__ import annotations

import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

from review.cli import main
from review.errors import ReviewApiError, ReviewConfigError
from review.publish import PublishResult

VERSION = {
    "id": 512,
    "name": "V03",
    "path": "proj/SQ010/SH0100/comp/V03",
    "media": [{"id": 128, "filename": "SH0100_comp_v003.mov", "url": "https://minio/x"}],
}


class FakeClient:
    """Stands in for ReviewClient: records the calls the CLI makes."""

    def __init__(self, *_args, **_kwargs) -> None:
        self.calls: list[tuple] = []
        self.raises: Exception | None = None

    def _record(self, name: str, *args, **kwargs):
        self.calls.append((name, args, kwargs))
        if self.raises:
            raise self.raises

    def publish(self, path, filepath, **options):
        self._record("publish", path, filepath, **options)
        return PublishResult(
            media_id=128,
            media={"status": "PROCESSING"},
            version=VERSION,
            published=not options.get("publish") is False,
            idempotency_key="key",
            created=["shot"],
        )

    def latest(self, path, **options):
        self._record("latest", path, **options)
        return {"version": VERSION}

    def download(self, media_id, destination, **options):
        self._record("download", media_id, destination, **options)
        with open(destination, "wb") as handle:
            handle.write(b"BYTES")
        return destination

    def resolve(self, path):
        self._record("resolve", path)
        return {"kind": "task", "path": path}

    def me(self):
        self._record("me")
        return {"user": {"email": "farm@studio.com", "role": "ARTIST"}, "auth": {"kind": "api_token"}}


def run(argv, client=None):
    made = client or FakeClient()
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = main(argv, factory=lambda *_a, **_k: made)
    return code, out.getvalue(), err.getvalue(), made


class Publish(unittest.TestCase):
    def test_publishes_and_prints_where_it_landed(self) -> None:
        code, out, _err, client = run(["publish", "PROJ/SQ010/SH0100/anim", "/renders/x.mov"])
        self.assertEqual(code, 0)
        self.assertIn("proj/SQ010/SH0100/comp/V03", out)
        self.assertIn("PROCESSING", out)
        self.assertEqual(client.calls[0][1], ("PROJ/SQ010/SH0100/anim", "/renders/x.mov"))

    def test_passes_the_flags_a_render_script_needs(self) -> None:
        _code, _out, _err, client = run(
            ["publish", "PROJ/SH/anim", "/x.mov", "--no-publish", "--start-frame", "1001", "--strict-path"],
        )
        options = client.calls[0][2]
        self.assertFalse(options["publish"])
        self.assertFalse(options["create_missing"])
        self.assertEqual(options["start_frame"], 1001)

    def test_json_output_is_machine_readable(self) -> None:
        code, out, _err, _client = run(["--json", "publish", "PROJ/SH/anim", "/x.mov"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["mediaId"], 128)


class Reads(unittest.TestCase):
    def test_latest_names_the_version_and_its_files(self) -> None:
        code, out, _err, client = run(["latest", "PROJ/SQ010/SH0100", "--department", "comp"])
        self.assertEqual(code, 0)
        self.assertIn("SH0100_comp_v003.mov", out)
        self.assertEqual(client.calls[0][2]["department"], "comp")

    def test_latest_can_download_every_media(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            code, out, _err, client = run(["latest", "PROJ/SQ010/SH0100", "--download", folder])
            self.assertEqual(code, 0)
            self.assertTrue(os.path.exists(os.path.join(folder, "SH0100_comp_v003.mov")))
            self.assertIn(folder, out)
            # Chaque média signe son URL au moment d'être rapatrié : une URL demandée en
            # même temps que la liste aurait expiré pendant le plan précédent.
            self.assertFalse(client.calls[0][2]["urls"])
            self.assertEqual(client.calls[1][0], "download")

    def test_urls_are_only_requested_when_asked(self) -> None:
        _code, out, _err, _client = run(["--json", "latest", "PROJ/SQ010/SH0100", "--urls"])
        self.assertIn("https://minio/x", out)

    def test_drafts_asks_for_unpublished_versions(self) -> None:
        _code, _out, _err, client = run(["latest", "PROJ/SH", "--drafts"])
        self.assertFalse(client.calls[0][2]["published"])

    def test_whoami_and_resolve_report_the_essentials(self) -> None:
        _code, out, _err, _client = run(["whoami"])
        self.assertIn("farm@studio.com", out)
        _code, out, _err, _client = run(["resolve", "PROJ/SQ010/SH0100/anim"])
        self.assertIn("task PROJ/SQ010/SH0100/anim", out)


class ConsoleEncoding(unittest.TestCase):
    """Une console Windows en cp1252 ne doit pas faire échouer une publication réussie."""

    class NarrowStream(io.StringIO):
        encoding = "cp1252"

        def write(self, text: str) -> int:
            text.encode(self.encoding)  # lève UnicodeEncodeError comme la vraie console
            return super().write(text)

    def test_replaces_what_the_console_cannot_spell(self) -> None:
        from review.cli import _say

        stream = self.NarrowStream()
        _say("Shot « SH0100 » introuvable", stream=stream)
        self.assertIn("SH0100", stream.getvalue())


class ExitCodes(unittest.TestCase):
    def test_a_refusal_exits_one_and_names_its_code(self) -> None:
        client = FakeClient()
        client.raises = ReviewApiError(403, code="TOKEN_PROJECT_SCOPE", message="wrong project", url="u")
        code, _out, err, _client = run(["publish", "PROJ/SH/anim", "/x.mov"], client)
        self.assertEqual(code, 1)
        self.assertIn("TOKEN_PROJECT_SCOPE", err)

    def test_an_unconfigured_workstation_exits_two(self) -> None:
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = main(
                ["whoami"],
                factory=lambda *_a, **_k: (_ for _ in ()).throw(ReviewConfigError("No ReView URL")),
            )
        self.assertEqual(code, 2)
        self.assertIn("No ReView URL", err.getvalue())


if __name__ == "__main__":  # pragma: no cover - manual run
    unittest.main()
