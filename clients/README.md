# ReView clients

What a studio installs on a workstation or a farm node to talk to ReView. Everything here
speaks the **`/api/v1`** integration API — the contract that does not move without a
version bump — never the internal `/api` used by the web interface.

| Folder | What it is |
|---|---|
| [`python/`](python/README.md) | The client: session with retries, publish, read, `review` CLI. Standard library only. |
| [`dcc/`](dcc/) | Thin integrations built on it: `blender_review_publish.py` (add-on), `nuke_review_publish.py` (menu + `afterRender` hook). |

Both need three environment variables, normally set by the studio launcher:

```bash
export REVIEW_URL="https://review.mystudio.com"
export REVIEW_TOKEN="rvk_…"      # service token, bound to the project
export REVIEW_PROJECT="PROJ"     # the show, so filenames need not carry it
export PYTHONPATH="/path/to/ReView-app/clients/python:$PYTHONPATH"
```

An API token opens **only** `/api/v1`. Bind it to a single project when you issue it: a
token that leaks off a farm node then cannot touch another show. See
[`DOCUMENTATION/api/authentication.md`](../DOCUMENTATION/api/authentication.md).

Documentation: [`DOCUMENTATION/api/python-client.md`](../DOCUMENTATION/api/python-client.md)
(installation, DCC recipes) and
[`DOCUMENTATION/api/v1-integration.md`](../DOCUMENTATION/api/v1-integration.md) (the HTTP
contract itself).
