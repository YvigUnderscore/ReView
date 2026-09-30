# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""``review`` command line - the same three calls, from a shell or a render script.

    review publish PROJ/SQ010/SH0100/anim /renders/SH0100_anim_v001.mov
    review latest PROJ/SQ010/SH0100 --download /tmp
    review resolve PROJ/SQ010/SH0100/anim
    review whoami

Exit codes: ``0`` fine, ``1`` the API refused (the stable ``code`` is printed on stderr),
``2`` bad usage or unconfigured workstation. A post-render script can branch on that.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Callable, Sequence

from .client import ReviewClient
from .errors import ReviewApiError, ReviewConfigError, ReviewError


def _say(text: str, *, stream: Any = None) -> None:
    """Print without ever dying on the console encoding.

    A Windows console is often cp1252, and a ReView message may carry « » or an accent:
    a publish must not fail at the last line because its report cannot be spelled.
    """
    target = stream or sys.stdout
    try:
        print(text, file=target)
    except UnicodeEncodeError:
        encoding = getattr(target, "encoding", None) or "ascii"
        print(text.encode(encoding, "replace").decode(encoding, "replace"), file=target)


def _emit(payload: Any, as_json: bool, human: str) -> None:
    _say(json.dumps(payload, indent=2, default=str) if as_json else human)


def _publish(client: ReviewClient, args: argparse.Namespace) -> None:
    result = client.publish(
        args.path,
        args.file,
        version_name=args.version_name,
        kind=args.kind,
        publish=not args.no_publish,
        submit_for_review=args.submit_for_review,
        create_missing=not args.strict_path,
        start_frame=args.start_frame,
        end_frame=args.end_frame,
        content_hash=not args.no_hash,
    )
    _emit(
        {
            "mediaId": result.media_id,
            "versionPath": result.version_path,
            "status": result.media.get("status"),
            "published": result.published,
            "created": result.created,
        },
        args.json,
        f"published {result.version_path or result.media_id} ({result.media.get('status')})",
    )


def _latest(client: ReviewClient, args: argparse.Namespace) -> None:
    # `--download` ne demande pas d'URL : `download()` signe la sienne, média par média,
    # au moment où il le rapatrie — une URL signée trop tôt expire pendant un gros plan.
    answer = client.latest(
        args.path,
        published=not args.drafts,
        urls=args.urls,
        department=args.department,
    )
    version = answer["version"]
    if args.download:
        for media in version.get("media", []):
            target = os.path.join(args.download, str(media["filename"]))
            client.download(int(media["id"]), target)
            _say(target)
        return
    files = ", ".join(str(m["filename"]) for m in version.get("media", []))
    _emit(answer, args.json, f"{version.get('path') or version.get('name')}: {files}")


def _resolve(client: ReviewClient, args: argparse.Namespace) -> None:
    answer = client.resolve(args.path)
    _emit(answer, args.json, f"{answer['kind']} {answer['path']}")


def _whoami(client: ReviewClient, args: argparse.Namespace) -> None:
    answer = client.me()
    auth = answer.get("auth", {})
    _emit(answer, args.json, f"{answer['user']['email']} ({answer['user']['role']}) via {auth.get('kind')}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="review", description="ReView pipeline client")
    parser.add_argument("--url", help="instance URL (default: $REVIEW_URL)")
    parser.add_argument("--token", help="API token (default: $REVIEW_TOKEN)")
    parser.add_argument("--json", action="store_true", help="print the raw JSON answer")
    subs = parser.add_subparsers(dest="command", required=True)

    publish = subs.add_parser("publish", help="publish a file at a pipeline path")
    publish.add_argument("path", help="PROJ/SQ010/SH0100/anim")
    publish.add_argument("file")
    publish.add_argument("--version-name")
    publish.add_argument("--kind", choices=["VIDEO", "IMAGE", "MODEL_3D", "SPLAT"])
    publish.add_argument("--no-publish", action="store_true", help="upload without publishing")
    publish.add_argument("--submit-for-review", action="store_true")
    publish.add_argument("--strict-path", action="store_true", help="fail instead of creating structure")
    publish.add_argument("--start-frame", type=int)
    publish.add_argument("--end-frame", type=int)
    publish.add_argument("--no-hash", action="store_true", help="skip the sha256 of the file")
    publish.set_defaults(run=_publish)

    latest = subs.add_parser("latest", help="the version to open for a path")
    latest.add_argument("path")
    latest.add_argument("--drafts", action="store_true", help="include unpublished versions")
    latest.add_argument("--department", help="restrict to one pipeline step")
    latest.add_argument("--urls", action="store_true", help="include presigned URLs")
    latest.add_argument("--download", metavar="DIR", help="download every media of the version")
    latest.set_defaults(run=_latest)

    resolve = subs.add_parser("resolve", help="pipeline path to entities")
    resolve.add_argument("path")
    resolve.set_defaults(run=_resolve)

    subs.add_parser("whoami", help="identity and powers of the token").set_defaults(run=_whoami)
    return parser


def main(argv: Sequence[str] | None = None, *, factory: Callable[..., ReviewClient] = ReviewClient) -> int:
    args = build_parser().parse_args(argv)
    try:
        client = factory(args.url, args.token)
        run = args.run
        run(client, args)
    except ReviewConfigError as exc:
        _say(str(exc), stream=sys.stderr)
        return 2
    except ReviewApiError as exc:
        # Le message du serveur peut porter des guillemets français : `_say` les encaisse.
        _say(f"{exc.status} {exc.code}: {exc.message}", stream=sys.stderr)
        return 1
    except ReviewError as exc:
        _say(str(exc), stream=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover - entry point
    raise SystemExit(main())
