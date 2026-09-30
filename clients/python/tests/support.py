# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Fake network for the client tests — no socket is ever opened.

The client only ever talks to an *opener* (``opener.open(request, timeout=…)``), which is
exactly the seam :mod:`urllib.request` offers. Recording requests here lets the tests
assert on what actually goes on the wire: method, URL, headers, body.
"""

from __future__ import annotations

import io
import json
import urllib.error
from typing import Any


class FakeResponse:
    """Minimal stand-in for an ``http.client.HTTPResponse``."""

    def __init__(self, body: bytes = b"{}", status: int = 200) -> None:
        self._stream = io.BytesIO(body)
        self.status = status

    def read(self, size: int = -1) -> bytes:
        return self._stream.read() if size == -1 else self._stream.read(size)

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_exc: object) -> bool:
        return False


def json_response(payload: Any, status: int = 200) -> FakeResponse:
    return FakeResponse(json.dumps(payload).encode(), status)


def http_error(status: int, payload: Any = None, *, retry_after: str | None = None) -> urllib.error.HTTPError:
    """An error answer. ``payload`` may be a mapping (JSON) or raw bytes (HTML page…)."""
    headers = {"Retry-After": retry_after} if retry_after else {}
    body = payload if isinstance(payload, bytes) else json.dumps(payload if payload is not None else {}).encode()
    return urllib.error.HTTPError("https://review.test", status, "boom", headers, io.BytesIO(body))


class FakeOpener:
    """Answers with a scripted queue; an exception in the queue is raised instead."""

    def __init__(self, *answers: Any) -> None:
        self.answers = list(answers)
        self.requests: list[Any] = []

    def open(self, request: Any, timeout: float | None = None) -> Any:  # noqa: A003 - urllib's name
        self.requests.append(request)
        self.timeouts = getattr(self, "timeouts", [])
        self.timeouts.append(timeout)
        answer = self.answers.pop(0) if self.answers else json_response({})
        if isinstance(answer, BaseException):
            raise answer
        return answer

    @property
    def urls(self) -> list[str]:
        return [r.full_url for r in self.requests]

    @property
    def methods(self) -> list[str]:
        return [r.get_method() for r in self.requests]

    def body_of(self, index: int) -> Any:
        data = self.requests[index].data
        return json.loads(data) if isinstance(data, (bytes, bytearray)) else data


class Recorder:
    """Collects the sleeps a retry policy asks for, without waiting for them."""

    def __init__(self) -> None:
        self.slept: list[float] = []

    def __call__(self, seconds: float) -> None:
        self.slept.append(seconds)
