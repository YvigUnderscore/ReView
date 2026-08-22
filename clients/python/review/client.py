# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""HTTP session for the ReView v1 API — standard library only.

Maya, Nuke, Houdini and Blender all ship a Python interpreter, and none of them
guarantees ``requests``. Anything that needs an install will not run on a farm node, so
this module uses :mod:`urllib` and nothing else.

What it adds over a bare ``urlopen``:

* one place for the base URL, the token and the ``Authorization`` header;
* retries with exponential backoff on 429 and 5xx, honouring ``Retry-After`` — a farm
  hitting the studio in parallel must back off, not hammer;
* retries **only** what is safe: reads, and writes carrying an ``Idempotency-Key``;
* typed errors (see :mod:`review.errors`) instead of ``HTTPError`` with a JSON blob;
* presigned URLs opened **without** the ``Authorization`` header — object storage refuses
  a request that carries two authentication mechanisms.
"""

from __future__ import annotations

import json
import os
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Mapping

from .errors import ReviewApiError, ReviewConfigError, ReviewTransportError

DEFAULT_TIMEOUT = 60.0
"""Seconds before an API call is considered lost. Uploads use their own, far longer."""

UPLOAD_TIMEOUT = 3600.0
CHUNK = 1 << 20

RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})
USER_AGENT = "review-python-client/1.0"


@dataclass(frozen=True)
class RetryPolicy:
    """Exponential backoff with jitter — the jitter is what un-synchronises a farm."""

    attempts: int = 4
    backoff: float = 0.5
    max_sleep: float = 30.0
    jitter: float = 0.25

    def delay(self, attempt: int, retry_after: float | None, rand: Callable[[], float]) -> float:
        base = retry_after if retry_after is not None else self.backoff * (2 ** (attempt - 1))
        return min(base, self.max_sleep) * (1.0 + self.jitter * rand())


def _bool(value: bool) -> str:
    return "true" if value else "false"


class ReviewClient:
    """A configured connection to one ReView instance.

    ``base_url`` and ``token`` fall back to the ``REVIEW_URL`` / ``REVIEW_TOKEN``
    environment variables, which is how a studio deploys the client: the launcher sets
    them, the tools never hard-code a token.

    ``opener`` and ``sleep`` exist for tests — pass a fake and nothing touches the network.
    """

    def __init__(
        self,
        base_url: str | None = None,
        token: str | None = None,
        *,
        timeout: float = DEFAULT_TIMEOUT,
        retry: RetryPolicy | None = None,
        opener: Any | None = None,
        sleep: Callable[[float], None] = time.sleep,
        rand: Callable[[], float] = random.random,
    ) -> None:
        base = (base_url if base_url is not None else os.environ.get("REVIEW_URL", "")).strip()
        secret = (token if token is not None else os.environ.get("REVIEW_TOKEN", "")).strip()
        if not base:
            raise ReviewConfigError("No ReView URL: pass base_url or set REVIEW_URL")
        if not secret:
            raise ReviewConfigError("No ReView token: pass token or set REVIEW_TOKEN")
        self.base_url = base.rstrip("/")
        self.timeout = timeout
        self.retry = retry or RetryPolicy()
        self._token = secret
        self._opener = opener if opener is not None else urllib.request.build_opener()
        self._sleep = sleep
        self._rand = rand

    # ── plumbing ────────────────────────────────────────────────────────────

    def url_for(self, path: str, params: Mapping[str, Any] | None = None) -> str:
        url = path if path.startswith("http") else self.base_url + path
        clean = {k: v for k, v in (params or {}).items() if v is not None}
        return f"{url}?{urllib.parse.urlencode(clean)}" if clean else url

    def request(
        self,
        method: str,
        path: str,
        *,
        body: Any | None = None,
        params: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        timeout: float | None = None,
    ) -> dict:
        """One JSON call. Returns the decoded body (``{}`` when the answer is empty)."""
        url = self.url_for(path, params)
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        head = {
            "Authorization": "Bearer " + self._token,
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }
        if payload is not None:
            head["Content-Type"] = "application/json"
        head.update(headers or {})
        # Une écriture ne se rejoue que si le serveur peut la reconnaître : sans clé
        # d'idempotence, un POST rejoué crée une seconde version.
        retryable = method.upper() in {"GET", "HEAD"} or "Idempotency-Key" in head
        raw = self._send(method.upper(), url, payload, head, timeout or self.timeout, retryable)
        return json.loads(raw) if raw else {}

    def _send(
        self,
        method: str,
        url: str,
        payload: bytes | None,
        headers: Mapping[str, str],
        timeout: float,
        retryable: bool,
    ) -> bytes:
        last: Exception = ReviewTransportError("No attempt was made", url=url)
        for attempt in range(1, self.retry.attempts + 1):
            request = urllib.request.Request(url, data=payload, method=method, headers=dict(headers))
            try:
                with self._opener.open(request, timeout=timeout) as response:
                    return response.read()
            except urllib.error.HTTPError as exc:
                last = _api_error(exc, url)
                if not retryable or exc.code not in RETRYABLE_STATUS:
                    raise last from exc
                wait = self.retry.delay(attempt, _retry_after(exc), self._rand)
            except (urllib.error.URLError, OSError) as exc:
                last = ReviewTransportError(f"{method} {url} failed: {exc}", url=url, cause=exc)
                if not retryable:
                    raise last from exc
                wait = self.retry.delay(attempt, None, self._rand)
            if attempt == self.retry.attempts:
                break
            self._sleep(wait)
        raise last

    # ── discovery and reads ─────────────────────────────────────────────────

    def me(self) -> dict:
        """Identity and real powers of the presented token."""
        return self.request("GET", "/api/v1/me")

    def schema(self) -> dict:
        """Values this instance accepts: enums, studio review statuses, scopes, events."""
        return self.request("GET", "/api/v1/schema")

    def resolve(self, pipeline_path: str) -> dict:
        """``PROJ/SQ010/SH0100/anim`` → the entities it names."""
        return self.request("GET", "/api/v1/resolve", params={"path": pipeline_path})

    def latest(
        self,
        pipeline_path: str | None = None,
        *,
        task_id: int | None = None,
        published: bool = True,
        urls: bool = False,
        department: str | None = None,
        expires_in: int | None = None,
    ) -> dict:
        """The version to open for a path (or a task), with its media.

        On a shot or an asset the winner is the most advanced pipeline step, not merely
        the most recent publish — the same rule the web interface applies.
        """
        params: dict[str, Any] = {
            "published": _bool(published),
            "urls": _bool(urls),
            "department": department,
            "expiresIn": expires_in,
        }
        if task_id is not None:
            return self.request("GET", f"/api/v1/tasks/{task_id}/versions/latest", params=params)
        if not pipeline_path:
            raise ValueError("latest() needs a pipeline path or a task_id")
        params["path"] = pipeline_path
        return self.request("GET", "/api/v1/latest", params=params)

    def media_url(self, media_id: int, *, variant: str = "source", expires_in: int | None = None) -> str:
        """Presigned URL of a media: ``source``, ``proxy`` or ``thumbnail``."""
        answer = self.request(
            "GET",
            f"/api/v1/media/{media_id}/url",
            params={"variant": variant, "expiresIn": expires_in},
        )
        return str(answer["url"])

    def events(
        self,
        since: int | None = None,
        *,
        limit: int = 100,
        project: str | None = None,
        events: str | None = None,
    ) -> dict:
        """Event journal, pulled by cursor. Without ``since``, returns today's cursor."""
        return self.request(
            "GET",
            "/api/v1/events",
            params={"since": since, "limit": limit, "project": project, "events": events},
        )

    # ── object storage (presigned, unauthenticated) ─────────────────────────

    def download(self, media_id: int, destination: str, *, variant: str = "source") -> str:
        """Fetch a media to ``destination``. Streams: a 40 GB plate never sits in memory."""
        url = self.media_url(media_id, variant=variant)
        request = urllib.request.Request(url, method="GET", headers={"User-Agent": USER_AGENT})
        with self._opener.open(request, timeout=UPLOAD_TIMEOUT) as response, open(destination, "wb") as out:
            while True:
                chunk = response.read(CHUNK)
                if not chunk:
                    break
                out.write(chunk)
        return destination

    def upload(self, url: str, filepath: str, content_type: str, *, size: int | None = None) -> None:
        """PUT a file straight to object storage — the API never sees the bytes.

        Retried like a read: the target is a presigned URL, writing it twice writes the
        same object. Each attempt re-opens the file, since a spent handle uploads nothing.
        """
        length = size if size is not None else os.path.getsize(filepath)
        headers = {"Content-Type": content_type, "Content-Length": str(length), "User-Agent": USER_AGENT}
        for attempt in range(1, self.retry.attempts + 1):
            try:
                with open(filepath, "rb") as handle:
                    request = urllib.request.Request(url, data=handle, method="PUT", headers=headers)
                    with self._opener.open(request, timeout=UPLOAD_TIMEOUT):
                        return
            except urllib.error.HTTPError as exc:
                error = _api_error(exc, url)
                if exc.code not in RETRYABLE_STATUS or attempt == self.retry.attempts:
                    raise error from exc
                self._sleep(self.retry.delay(attempt, _retry_after(exc), self._rand))
            except (urllib.error.URLError, OSError) as exc:
                if attempt == self.retry.attempts:
                    raise ReviewTransportError(f"upload failed: {exc}", url=url, cause=exc) from exc
                self._sleep(self.retry.delay(attempt, None, self._rand))

    # ── publish (see review.publish) ────────────────────────────────────────

    def publish(self, pipeline_path: str, filepath: str, **options: Any):
        """Publish a file — see :func:`review.publish.publish_file` for the options."""
        from .publish import publish_file

        return publish_file(self, pipeline_path, filepath, **options)


def _retry_after(exc: urllib.error.HTTPError) -> float | None:
    raw = exc.headers.get("Retry-After") if exc.headers else None
    try:
        return float(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None  # forme HTTP-date : on retombe sur le backoff exponentiel


def _api_error(exc: urllib.error.HTTPError, url: str) -> ReviewApiError:
    try:
        payload = json.loads(exc.read() or b"{}")
    except (ValueError, OSError):
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    return ReviewApiError(
        exc.code,
        code=payload.get("code"),
        message=str(payload.get("error") or exc.reason or "request failed"),
        url=url,
        payload=payload,
    )
