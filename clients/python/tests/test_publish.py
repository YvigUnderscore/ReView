# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""The publish flow: three calls, one key, and the bytes never touching the API."""

from __future__ import annotations

import hashlib
import os
import tempfile
import unittest

from review import ReviewClient, publish_file, sha256_of
from tests.support import FakeOpener, Recorder, http_error, json_response

OPENED = {
    "projectId": 3,
    "mediaId": 128,
    "uploadUrl": "https://minio/put/SH0100_anim_v001.mov?sig=1",
    "uploadMethod": "PUT",
    "contentType": "video/mp4",
    "version": {"id": 512, "name": "V01", "path": "proj/SQ010/SH0100/anim/V01"},
    "versionCreated": True,
    "created": ["shot", "task"],
}

DONE = {
    "media": {"id": 128, "status": "PROCESSING", "filename": "SH0100_anim_v001.mov"},
    "version": {"id": 512, "name": "V01", "status": "REVIEW", "path": "proj/SQ010/SH0100/anim/V01"},
    "published": True,
}


class PublishFlow(unittest.TestCase):
    def setUp(self) -> None:
        self.folder = tempfile.TemporaryDirectory()
        self.render = os.path.join(self.folder.name, "SH0100_anim_v001.mov")
        with open(self.render, "wb") as handle:
            handle.write(b"MOVIE-BYTES")
        self.opener = FakeOpener(json_response(OPENED), json_response({}), json_response(DONE))
        self.client = ReviewClient(
            "https://review.test",
            "rvk_" + "a" * 40,
            opener=self.opener,
            sleep=Recorder(),
            rand=lambda: 0.0,
        )

    def tearDown(self) -> None:
        self.folder.cleanup()

    def test_opens_uploads_and_closes(self) -> None:
        result = publish_file(self.client, "PROJ/SQ010/SH0100/anim", self.render, start_frame=1001, end_frame=1096)

        self.assertEqual(self.opener.methods, ["POST", "PUT", "POST"])
        self.assertEqual(self.opener.urls[0], "https://review.test/api/v1/publish")
        self.assertEqual(self.opener.urls[1], OPENED["uploadUrl"])
        self.assertEqual(self.opener.urls[2], "https://review.test/api/v1/publish/128/complete")

        body = self.opener.body_of(0)
        self.assertEqual(body["path"], "PROJ/SQ010/SH0100/anim")
        self.assertEqual(body["filename"], "SH0100_anim_v001.mov")
        self.assertEqual(body["size"], len(b"MOVIE-BYTES"))
        self.assertEqual(body["shot"], {"startFrame": 1001, "endFrame": 1096})
        self.assertTrue(body["createMissing"])

        self.assertEqual(result.media_id, 128)
        self.assertEqual(result.version_path, "proj/SQ010/SH0100/anim/V01")
        self.assertEqual(result.media["status"], "PROCESSING")
        self.assertEqual(result.created, ["shot", "task"])
        self.assertTrue(result.published)

    # Rejouer après un timeout ne doit pas ouvrir une seconde version : c'est la clé qui
    # permet au serveur de reconnaître l'appel, et les deux appels la portent.
    def test_the_same_idempotency_key_covers_both_api_calls(self) -> None:
        result = publish_file(self.client, "PROJ/SQ010/SH0100/anim", self.render)
        opened = self.opener.requests[0].headers["Idempotency-key"]
        closed = self.opener.requests[2].headers["Idempotency-key"]
        self.assertEqual(opened, result.idempotency_key)
        self.assertEqual(closed, result.idempotency_key + "-complete")

    def test_hashes_the_file_so_the_worker_can_check_it(self) -> None:
        publish_file(self.client, "PROJ/SQ010/SH0100/anim", self.render)
        expected = hashlib.sha256(b"MOVIE-BYTES").hexdigest()
        self.assertEqual(self.opener.body_of(0)["contentHash"], expected)
        self.assertEqual(sha256_of(self.render), expected)

    def test_can_skip_the_hash_on_a_very_large_render(self) -> None:
        publish_file(self.client, "PROJ/SQ010/SH0100/anim", self.render, content_hash=False)
        self.assertNotIn("contentHash", self.opener.body_of(0))

    def test_holds_the_media_back_when_asked(self) -> None:
        publish_file(self.client, "PROJ/SQ010/SH0100/anim", self.render, publish=False, submit_for_review=True)
        self.assertEqual(self.opener.body_of(2), {"publish": False, "submitForReview": True})

    def test_passes_the_usd_selection_and_the_strict_path_flag(self) -> None:
        publish_file(
            self.client,
            "PROJ/assets/hero/model",
            self.render,
            create_missing=False,
            version_name="V07",
            usd={"variants": {"/World/Set": {"modelingVariant": "hero"}}},
        )
        body = self.opener.body_of(0)
        self.assertFalse(body["createMissing"])
        self.assertEqual(body["versionName"], "V07")
        self.assertEqual(body["usd"], {"variants": {"/World/Set": {"modelingVariant": "hero"}}})

    def test_a_refused_opening_never_uploads(self) -> None:
        self.opener.answers = [http_error(403, {"code": "PROJECT_QUOTA", "error": "quota"})]
        with self.assertRaises(Exception):
            publish_file(self.client, "PROJ/SQ010/SH0100/anim", self.render)
        self.assertEqual(self.opener.methods, ["POST"])


if __name__ == "__main__":  # pragma: no cover - manual run
    unittest.main()
