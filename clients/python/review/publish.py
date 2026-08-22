# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Publishing a file the DCC just wrote — three calls, one idempotency key.

1. ``POST /api/v1/publish`` opens the publication: missing links of the pipeline path are
   created, the version is opened, a presigned upload URL comes back.
2. ``PUT`` straight to object storage.
3. ``POST /api/v1/publish/{mediaId}/complete`` validates the bytes and publishes.

The idempotency key is generated once and reused on both API calls: after a timeout the
client replays the same request and the server returns the original answer instead of
opening a second version. That is the whole point of publishing from a workstation whose
link to the studio is not guaranteed.
"""

from __future__ import annotations

import hashlib
import os
import uuid
from dataclasses import dataclass, field
from typing import Any

CHUNK = 1 << 20


@dataclass
class PublishResult:
    """What the caller needs afterwards: where it landed, and what state it is in."""

    media_id: int
    media: dict
    version: dict
    published: bool
    idempotency_key: str
    created: list = field(default_factory=list)

    @property
    def version_path(self) -> str | None:
        """Canonical pipeline path of the version, ``None`` on a loose asset version."""
        path = self.version.get("path")
        return str(path) if path else None


def sha256_of(filepath: str, chunk: int = CHUNK) -> str:
    """Content hash, read in chunks — a 40 GB render must not be loaded to be hashed."""
    digest = hashlib.sha256()
    with open(filepath, "rb") as handle:
        for block in iter(lambda: handle.read(chunk), b""):
            digest.update(block)
    return digest.hexdigest()


def publish_file(
    client: Any,
    pipeline_path: str,
    filepath: str,
    *,
    version_name: str | None = None,
    kind: str | None = None,
    content_type: str | None = None,
    publish: bool = True,
    submit_for_review: bool = False,
    create_missing: bool = True,
    reuse_version: bool = False,
    start_frame: int | None = None,
    end_frame: int | None = None,
    shot_name: str | None = None,
    usd: dict | None = None,
    content_hash: bool = True,
    idempotency_key: str | None = None,
) -> PublishResult:
    """Publish ``filepath`` at ``pipeline_path`` (``PROJ/SQ010/SH0100/anim``).

    ``content_hash`` computes a sha256 the worker re-checks; turn it off for a very large
    file on a slow disk, at the cost of losing the corruption check. ``publish=False``
    uploads without exposing the media — useful for a nightly that publishes later.
    """
    key = idempotency_key or str(uuid.uuid4())
    shot = {
        k: v
        for k, v in (("name", shot_name), ("startFrame", start_frame), ("endFrame", end_frame))
        if v is not None
    }
    body: dict[str, Any] = {
        "path": pipeline_path,
        "filename": os.path.basename(filepath),
        "size": os.path.getsize(filepath),
        "createMissing": create_missing,
    }
    if content_hash:
        body["contentHash"] = sha256_of(filepath)
    for name, value in (
        ("versionName", version_name),
        ("kind", kind),
        ("contentType", content_type),
        ("usd", usd),
    ):
        if value is not None:
            body[name] = value
    if reuse_version:
        body["reuseVersion"] = True
    if shot:
        body["shot"] = shot

    opened = client.request("POST", "/api/v1/publish", body=body, headers={"Idempotency-Key": key})
    client.upload(opened["uploadUrl"], filepath, opened["contentType"], size=body["size"])
    done = client.request(
        "POST",
        f"/api/v1/publish/{opened['mediaId']}/complete",
        body={"publish": publish, "submitForReview": submit_for_review},
        headers={"Idempotency-Key": key + "-complete"},
    )
    return PublishResult(
        media_id=int(opened["mediaId"]),
        media=done.get("media", {}),
        version=done.get("version") or opened.get("version", {}),
        published=bool(done.get("published", False)),
        idempotency_key=key,
        created=list(opened.get("created", [])),
    )
