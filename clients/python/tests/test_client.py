# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Session behaviour: headers, query building, error mapping, retries."""

from __future__ import annotations

import os
import tempfile
import unittest
import urllib.error

from review import RetryPolicy, ReviewApiError, ReviewClient, ReviewConfigError, ReviewTransportError
from tests.support import FakeOpener, FakeResponse, Recorder, http_error, json_response


def client(*answers, **options) -> ReviewClient:
    opener = FakeOpener(*answers)
    sleeper = Recorder()
    made = ReviewClient(
        "https://review.test/",
        "rvk_" + "a" * 40,
        opener=opener,
        sleep=sleeper,
        rand=lambda: 0.0,
        **options,
    )
    made.opener = opener  # type: ignore[attr-defined]
    made.sleeper = sleeper  # type: ignore[attr-defined]
    return made


class Configuration(unittest.TestCase):
    def test_refuses_to_start_without_url_or_token(self) -> None:
        with self.assertRaises(ReviewConfigError):
            ReviewClient("", "rvk_x")
        with self.assertRaises(ReviewConfigError):
            ReviewClient("https://review.test", "")

    def test_reads_the_workstation_environment(self) -> None:
        env = {"REVIEW_URL": "https://studio.test/", "REVIEW_TOKEN": "rvk_env"}
        previous = {k: os.environ.get(k) for k in env}
        os.environ.update(env)
        try:
            self.assertEqual(ReviewClient().base_url, "https://studio.test")
        finally:
            for key, value in previous.items():
                os.environ.pop(key, None) if value is None else os.environ.update({key: value})


class Requests(unittest.TestCase):
    def test_sends_the_token_and_accepts_json(self) -> None:
        api = client(json_response({"user": {"id": 1}}))
        api.me()
        request = api.opener.requests[0]
        self.assertEqual(request.full_url, "https://review.test/api/v1/me")
        self.assertTrue(request.headers["Authorization"].startswith("Bearer rvk_"))
        self.assertEqual(request.headers["Accept"], "application/json")

    def test_drops_empty_query_parameters(self) -> None:
        api = client(json_response({"version": {}}))
        api.latest("PROJ/SQ010/SH0100")
        url = api.opener.urls[0]
        self.assertIn("published=true", url)
        self.assertIn("urls=false", url)
        self.assertNotIn("department", url)

    def test_addresses_a_task_by_id_when_given_one(self) -> None:
        api = client(json_response({"version": {}}))
        api.latest(task_id=87, published=False)
        self.assertIn("/api/v1/tasks/87/versions/latest", api.opener.urls[0])
        self.assertIn("published=false", api.opener.urls[0])

    def test_an_empty_body_decodes_to_an_empty_mapping(self) -> None:
        api = client(json_response(None))
        self.assertEqual(api.request("GET", "/api/v1/me"), None)

    def test_media_url_returns_the_presigned_link(self) -> None:
        api = client(json_response({"url": "https://minio/x?sig=1", "variant": "proxy"}))
        self.assertEqual(api.media_url(128, variant="proxy"), "https://minio/x?sig=1")
        self.assertIn("variant=proxy", api.opener.urls[0])


class Errors(unittest.TestCase):
    def test_maps_a_refusal_to_its_stable_code(self) -> None:
        api = client(http_error(404, {"error": "Shot « SH0100 » not found", "code": "SHOT_NOT_FOUND"}))
        with self.assertRaises(ReviewApiError) as caught:
            api.resolve("PROJ/SQ010/SH0100")
        self.assertEqual(caught.exception.code, "SHOT_NOT_FOUND")
        self.assertEqual(caught.exception.status, 404)
        self.assertFalse(caught.exception.is_retryable)

    # A broken front end returns an HTML page, not the API's JSON: the client must
    # still produce a usable error.
    def test_survives_an_error_body_that_is_not_json(self) -> None:
        api = client(http_error(400, b"<html>bad gateway</html>"))
        with self.assertRaises(ReviewApiError) as caught:
            api.me()
        self.assertEqual(caught.exception.status, 400)
        self.assertIsNone(caught.exception.code)

    def test_reports_a_transport_failure_as_such(self) -> None:
        api = client(OSError("connection reset"), OSError("connection reset"), retry=RetryPolicy(attempts=2))
        with self.assertRaises(ReviewTransportError):
            api.request("POST", "/api/v1/publish", body={}, headers={"Idempotency-Key": "k"})


class Retries(unittest.TestCase):
    def test_retries_a_read_until_the_studio_answers(self) -> None:
        api = client(http_error(503), http_error(503), json_response({"user": {"id": 1}}))
        self.assertEqual(api.me()["user"]["id"], 1)
        self.assertEqual(len(api.sleeper.slept), 2)
        self.assertEqual(api.sleeper.slept, [0.5, 1.0])

    def test_honours_retry_after(self) -> None:
        api = client(http_error(429, retry_after="7"), json_response({}))
        api.me()
        self.assertEqual(api.sleeper.slept, [7.0])

    # Without an idempotency key, replaying a POST would publish a second version.
    def test_never_replays_a_write_that_cannot_be_recognised(self) -> None:
        api = client(http_error(503), json_response({}))
        with self.assertRaises(ReviewApiError):
            api.request("POST", "/api/v1/publish", body={"path": "PROJ/SH/anim"})
        self.assertEqual(api.sleeper.slept, [])

    def test_replays_a_write_that_carries_an_idempotency_key(self) -> None:
        api = client(http_error(503), json_response({"mediaId": 5}))
        answer = api.request("POST", "/api/v1/publish", body={}, headers={"Idempotency-Key": "abc"})
        self.assertEqual(answer["mediaId"], 5)
        self.assertEqual(api.opener.requests[1].headers["Idempotency-key"], "abc")

    def test_gives_up_after_the_configured_attempts(self) -> None:
        api = client(*[http_error(503) for _ in range(3)], retry=RetryPolicy(attempts=3))
        with self.assertRaises(ReviewApiError):
            api.me()
        self.assertEqual(len(api.sleeper.slept), 2)

    def test_a_client_error_is_never_retried(self) -> None:
        api = client(http_error(403, {"code": "TOKEN_PROJECT_SCOPE"}), json_response({}))
        with self.assertRaises(ReviewApiError):
            api.me()
        self.assertEqual(api.sleeper.slept, [])


class Downloads(unittest.TestCase):
    # A presigned URL already carries its signature: adding the authorization header makes
    # the object storage reject the request.
    def test_downloads_without_the_authorization_header(self) -> None:
        api = client(json_response({"url": "https://minio/plate.mov"}), json_response("BYTES"))
        with tempfile.TemporaryDirectory() as folder:
            target = os.path.join(folder, "plate.mov")
            api.download(128, target)
            self.assertTrue(os.path.exists(target))
        storage_request = api.opener.requests[1]
        self.assertEqual(storage_request.full_url, "https://minio/plate.mov")
        self.assertNotIn("Authorization", storage_request.headers)

    def test_uploads_with_a_length_and_reopens_the_file_on_retry(self) -> None:
        api = client(http_error(503), json_response({}))
        with tempfile.TemporaryDirectory() as folder:
            source = os.path.join(folder, "render.mov")
            with open(source, "wb") as handle:
                handle.write(b"0123456789")
            api.upload("https://minio/put", source, "video/mp4")
        self.assertEqual(api.opener.methods, ["PUT", "PUT"])
        self.assertEqual(api.opener.requests[0].headers["Content-length"], "10")
        self.assertEqual(api.opener.requests[1].headers["Content-type"], "video/mp4")


SIGNED = {"url": "https://minio/plate.mov?sig=1"}


class BreaksMidStream(FakeResponse):
    """Hands out one chunk, then the connection drops."""

    def read(self, size: int = -1) -> bytes:
        if self._stream.tell():
            raise ConnectionResetError("connection reset by peer")
        return super().read(4)


class AtomicDownloads(unittest.TestCase):
    """``download`` retries what is transient and never leaves half a plate behind."""

    def setUp(self) -> None:
        self._folder = tempfile.TemporaryDirectory()
        self.folder = self._folder.name
        self.target = os.path.join(self.folder, "plate.mov")

    def tearDown(self) -> None:
        self._folder.cleanup()

    def leftovers(self) -> list[str]:
        return sorted(name for name in os.listdir(self.folder) if name != "plate.mov")

    def test_writes_the_bytes_and_leaves_no_temporary_file(self) -> None:
        api = client(json_response(SIGNED), FakeResponse(b"PLATE", headers={"Content-Length": "5"}))
        self.assertEqual(api.download(128, self.target), self.target)
        with open(self.target, "rb") as handle:
            self.assertEqual(handle.read(), b"PLATE")
        self.assertEqual(self.leftovers(), [])

    def test_retries_a_busy_storage_and_signs_a_fresh_url_each_time(self) -> None:
        api = client(
            json_response(SIGNED),
            http_error(503),
            json_response(SIGNED),
            FakeResponse(b"PLATE"),
        )
        api.download(128, self.target)
        self.assertEqual(api.sleeper.slept, [0.5])
        self.assertEqual(sum("/api/v1/media/128/url" in url for url in api.opener.urls), 2)
        self.assertEqual(self.leftovers(), [])

    def test_retries_a_connection_dropped_mid_stream(self) -> None:
        api = client(
            json_response(SIGNED),
            BreaksMidStream(b"PLATE-PART"),
            json_response(SIGNED),
            FakeResponse(b"PLATE"),
        )
        api.download(128, self.target)
        with open(self.target, "rb") as handle:
            self.assertEqual(handle.read(), b"PLATE")
        self.assertEqual(self.leftovers(), [])

    # A proxy that closes early would otherwise hand over a short file as if it were whole.
    def test_treats_a_truncated_body_as_transient(self) -> None:
        api = client(
            json_response(SIGNED),
            FakeResponse(b"PLA", headers={"Content-Length": "5"}),
            json_response(SIGNED),
            FakeResponse(b"PLATE", headers={"Content-Length": "5"}),
        )
        api.download(128, self.target)
        with open(self.target, "rb") as handle:
            self.assertEqual(handle.read(), b"PLATE")
        self.assertEqual(len(api.sleeper.slept), 1)

    def test_gives_up_with_a_transport_error_and_keeps_the_previous_file(self) -> None:
        with open(self.target, "wb") as handle:
            handle.write(b"OLD")
        answers = []
        for _ in range(2):
            answers += [json_response(SIGNED), urllib.error.URLError("timed out")]
        api = client(*answers, retry=RetryPolicy(attempts=2))
        with self.assertRaises(ReviewTransportError) as caught:
            api.download(128, self.target)
        self.assertIsInstance(caught.exception.cause, urllib.error.URLError)
        with open(self.target, "rb") as handle:
            self.assertEqual(handle.read(), b"OLD")
        self.assertEqual(self.leftovers(), [])

    def test_a_refusal_is_typed_and_never_retried(self) -> None:
        api = client(json_response(SIGNED), http_error(403, {"code": "SIGNATURE_EXPIRED"}))
        with self.assertRaises(ReviewApiError) as caught:
            api.download(128, self.target)
        self.assertEqual(caught.exception.status, 403)
        self.assertEqual(api.sleeper.slept, [])
        self.assertFalse(os.path.exists(self.target))
        self.assertEqual(self.leftovers(), [])

    # Retrying cannot create a missing folder or free a full disk: surface the OSError as is.
    def test_a_local_write_failure_is_not_retried_nor_disguised(self) -> None:
        api = client(json_response(SIGNED), FakeResponse(b"PLATE"))
        missing = os.path.join(self.folder, "no-such-dir", "plate.mov")
        with self.assertRaises(FileNotFoundError):
            api.download(128, missing)
        self.assertEqual(api.sleeper.slept, [])
        self.assertEqual(len(api.opener.requests), 1)


if __name__ == "__main__":  # pragma: no cover - manual run
    unittest.main()
