# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""ReView pipeline client — talk to the ``/api/v1`` integration API from a DCC.

    from review import ReviewClient

    review = ReviewClient()                       # REVIEW_URL + REVIEW_TOKEN
    result = review.publish("PROJ/SQ010/SH0100/anim", "/renders/SH0100_anim_v001.mov")
    print(result.version_path, result.media["status"])

    plate = review.latest("PROJ/SQ010/SH0100", department="comp", urls=True)
    review.download(plate["version"]["media"][0]["id"], "/tmp/plate.mov")

Standard library only: it runs from a Maya shelf, a Nuke callback, a Houdini ROP or a
farm node without installing anything.
"""

from .client import ReviewClient, RetryPolicy
from .errors import ReviewApiError, ReviewConfigError, ReviewError, ReviewTransportError
from .publish import PublishResult, publish_file, sha256_of

__all__ = [
    "PublishResult",
    "ReviewApiError",
    "ReviewClient",
    "ReviewConfigError",
    "ReviewError",
    "ReviewTransportError",
    "RetryPolicy",
    "publish_file",
    "sha256_of",
]

__version__ = "1.0.0"
