# ReView Python client

Talks to the **`/api/v1`** integration API: publish what a DCC just wrote, and read back
what a DCC needs to open. Standard library only — no `requests`, no wheel to install on a
farm node.

- Targets **Python 3.10+**; annotations are postponed (`from __future__ import
  annotations`), so it also imports on the 3.8/3.9 interpreters shipped by older DCCs.
- Reference documentation: [`DOCUMENTATION/api/v1-integration.md`](../../DOCUMENTATION/api/v1-integration.md)
  and [`DOCUMENTATION/api/python-client.md`](../../DOCUMENTATION/api/python-client.md).
- Licence: AGPL-3.0-or-later, like the rest of ReView.

## Install

Nothing to install in the general case — put the folder on `PYTHONPATH`:

```bash
export PYTHONPATH="/mnt/pipeline/ReView-app/clients/python:$PYTHONPATH"
export REVIEW_URL="https://review.mystudio.com"
export REVIEW_TOKEN="rvk_…"          # a service token, bound to the project
python -m review whoami
```

For a workstation that can install packages:

```bash
pip install -e clients/python        # provides the `review` command
```

## Use from Python

```python
from review import ReviewClient

review = ReviewClient()                        # REVIEW_URL + REVIEW_TOKEN

# Publish — creates the missing sequence/shot/task, uploads, publishes.
result = review.publish(
    "PROJ/SQ010/SH0100/anim",
    "/renders/PROJ/SQ010/SH0100/SH0100_anim_v001.mov",
    start_frame=1001,
    end_frame=1096,
)
print(result.version_path, result.media["status"])

# Read — the version a viewer would open for this shot, most advanced step first.
answer = review.latest("PROJ/SQ010/SH0100", department="comp")
plate = answer["version"]["media"][0]
review.download(plate["id"], "/tmp/" + plate["filename"])   # signs its own URL, streams
```

Other calls: `me()`, `schema()`, `resolve(path)`, `media_url(id, variant=…)`,
`events(since=…)`, `upload(url, filepath, content_type)`.

## Command line

```bash
review publish PROJ/SQ010/SH0100/anim /renders/SH0100_anim_v001.mov --start-frame 1001
review latest PROJ/SQ010/SH0100 --download /tmp
review resolve PROJ/SQ010/SH0100/anim
review whoami
```

Exit codes: `0` fine, `1` the API refused (the stable `code` goes to stderr), `2` the
workstation is not configured. `--json` prints the raw answer for a wrapper script.

## What it does for you

| Concern | Behaviour |
|---|---|
| Retries | 429 and 5xx, exponential backoff with jitter, `Retry-After` honoured |
| Safety | writes are replayed **only** when they carry an `Idempotency-Key` (publish does) |
| Idempotency | one key per publish, reused by both API calls — a replay never opens a second version |
| Large files | hashing and uploading stream in 1 MB chunks; a 40 GB plate never sits in memory |
| Object storage | presigned URLs are opened **without** the `Authorization` header |
| Errors | `ReviewApiError.code` is stable; `message` is human and may be localised — never branch on it |

## Tests

`unittest`, from the standard library — the same constraint as the client itself: the
suite must run inside a DCC interpreter, where installing `pytest` is not an option.

```bash
cd clients/python
python -m unittest discover -s . -t .
```

No socket is opened: the tests inject a fake `urllib` opener (`tests/support.py`) and a
fake clock, so retries and backoff are asserted without waiting.
