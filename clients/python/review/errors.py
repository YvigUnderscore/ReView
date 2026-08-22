# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Errors raised by the ReView client.

Three kinds, because a caller reacts to them differently:

* :class:`ReviewConfigError` — the workstation is not set up (no URL, no token).
  Nothing to retry: tell the artist.
* :class:`ReviewApiError` — the server answered and refused. ``code`` is the stable
  machine-readable string (``SHOT_NOT_FOUND``, ``PROJECT_QUOTA``…); ``message`` is meant
  for a human and may be localised, so never branch on it.
* :class:`ReviewTransportError` — nothing answered (DNS, TLS, timeout, reset). The client
  has already retried what could be retried.
"""

from __future__ import annotations


class ReviewError(Exception):
    """Base class — catch this one to catch them all."""


class ReviewConfigError(ReviewError):
    """The client cannot even be built (missing base URL or token)."""


class ReviewTransportError(ReviewError):
    """The request never reached a ReView answer."""

    def __init__(self, message: str, *, url: str, cause: BaseException | None = None) -> None:
        super().__init__(message)
        self.url = url
        self.cause = cause


class ReviewApiError(ReviewError):
    """ReView answered with an error status."""

    def __init__(
        self,
        status: int,
        *,
        code: str | None,
        message: str,
        url: str,
        payload: dict | None = None,
    ) -> None:
        super().__init__(f"{status} {code or 'ERROR'}: {message}")
        self.status = status
        self.code = code
        self.message = message
        self.url = url
        self.payload = payload or {}

    @property
    def is_retryable(self) -> bool:
        """Worth trying again later — the studio is busy, not the request wrong."""
        return self.status == 429 or 500 <= self.status < 600
