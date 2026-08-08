# API v1 — pipeline integration

> Updated: 2026-08-08

**`/api/v1`** is the stable surface meant for tools: DCCs (Maya, Blender, Houdini,
Nuke), pipeline managers (Prism), bots and third-party synchronisations. It sits
next to `/api`, which serves the web interface and follows the product.

The separation is deliberate: the web API changes at the pace of the screens, while
an integration installed on a studio's workstations cannot be updated at every
release. What is published here does not move without a version bump.

Interactive reference: **`/api/docs`** (spec: `/api/openapi.json`). Every v1 endpoint
is generated from its own Zod validation schemas, so the documentation cannot drift
from the code.

## What makes it different from `/api`

| | `/api` (web) | `/api/v1` (integration) |
|---|---|---|
| Addressing | numeric ids | **pipeline paths** *and* ids |
| Creation | fails if it exists | **idempotent** (`ensure`) |
| Retries | no contract | `Idempotency-Key` header |
| Authorisation | role + membership | role + membership + **scopes** + project binding |
| Stability | follows the product | frozen within `v1` |

## Authentication

Send `Authorization: Bearer <token>` — either a session JWT or an API token
(`rvk_…`). See [Authentication & API access](authentication.md).

Two kinds of API token:

- **Personal** (`POST /api/auth/tokens`) — acts as its bearer, with their role.
- **Service** (`POST /api/admin/service-tokens`, admin only) — backed by a service
  account that cannot log in and never appears in the directory. Meant for a render
  farm, a daemon or a bot.

Both may be **bound to a single project** (`projectId`). A bound token cannot reach
another project, even if its bearer could — which is what makes a token safe to
deploy on a farm working on one film.

### Scopes

Tokens carry fine-grained scopes, `domain:action`:

```
projects  sequences  shots  assets  tasks  versions
media     comments   playlists  events  webhooks  users
```

…each with `:read` and `:write`, plus `admin` which covers everything. Granting
`x:write` implies `x:read`. The full list is served by `GET /api/auth/scopes`.

Tokens issued before scopes existed carry `read`/`write` and keep working: they are
expanded on the fly. Note that legacy `write` does **not** grant `webhooks:*` or
`users:*` — an old general-purpose token must not silently gain the ability to
create webhooks.

A scope never grants more than its bearer already has: role and project membership
are still enforced.

## Pipeline paths

A DCC knows names, not database ids. A path spells them out and becomes an address:

```
PROJ                              project
PROJ/SQ010                        sequence
PROJ/SQ010/SH0100                 shot
PROJ/SQ010/SH0100/anim            task
PROJ/SQ010/SH0100/anim/v003       version
PROJ/shots/SH0100                 shot with no sequence
PROJ/assets/hero/model/v002       asset branch
```

`shots` and `assets` are reserved keywords in second position; they disambiguate
"a sequence named X" from "a shot named X with no sequence". Resolution is
**case-insensitive** — a DCC writes `sh0100` where production typed `SH0100`.

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "$REVIEW/api/v1/resolve?path=PROJ/SQ010/SH0100/anim"
```

A missing link returns `404` naming the offending segment
(`SHOT_NOT_FOUND`, `TASK_NOT_FOUND`…), so a script can say *what* is missing.

Every resource carries its own canonical `path`, so a client can chain calls without
ever handling an id.

## Publishing from a DCC

Two calls. The file never transits through the API — it goes straight to object
storage, which is what makes a multi-gigabyte render viable.

**1. Open the publication.** Missing links in the path are created (sequence, shot,
task); the version number is computed unless you impose one.

```bash
curl -X POST "$REVIEW/api/v1/publish" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
        "path": "PROJ/SQ010/SH0100/anim",
        "filename": "SH0100_anim_v001.mov",
        "size": 184320000,
        "shot": { "startFrame": 1001, "endFrame": 1096 }
      }'
```

```json
{
  "version": { "id": 42, "name": "V01", "path": "PROJ/SQ010/SH0100/anim/V01" },
  "versionCreated": true,
  "created": ["shot", "task"],
  "mediaId": 128,
  "uploadUrl": "https://…",
  "uploadMethod": "PUT",
  "contentType": "video/mp4"
}
```

**2. Upload, then close it.**

```bash
curl -X PUT --upload-file SH0100_anim_v001.mov \
  -H "Content-Type: video/mp4" "$UPLOAD_URL"

curl -X POST "$REVIEW/api/v1/publish/128/complete" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{ "publish": true }'
```

`complete` validates the file (magic bytes, size, quotas), triggers transcoding or
thumbnailing, and publishes. The **version** is only marked published if the caller
is a supervisor — an artist publishes their media without the call failing over a
decision that is not theirs to make.

The media type is inferred from the extension (`.mov` → `VIDEO`, `.exr` → `IMAGE`,
`.usd` → `MODEL_3D`, `.splat` → `SPLAT`). An unknown extension is refused rather
than guessed; pass `kind` explicitly.

Set `createMissing: false` to fail instead of creating structure — useful when the
pipeline should be the only thing declaring shots.

### Publishing a USD scene with a variant selection

A DCC knows which variants and which purpose the scene should be shown with — it
knew before it wrote the file. Pass that selection as `usd` and the **first**
conversion is already the right one:

```bash
curl -X POST "$REVIEW/api/v1/publish" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "path": "PROJ/assets/hero/model",
        "filename": "hero_model_v001.usd",
        "usd": {
          "variants": { "/World/Hero": { "modelingVariant": "damaged" } },
          "purpose": "render"
        }
      }'
```

- `variants` — the chosen option per variant set, keyed by USD prim path. Optional,
  defaults to `{}` (each variant set keeps the selection authored in the scene).
  At most 64 prims; a prim path is at most 1024 characters, a variant name 200.
- `purpose` — `render`, `proxy` or `guide`. Optional, defaults to `render`.

Without it the conversion runs with the defaults, and matching the intended look
then costs a `POST /api/media/{id}/usd/recompose` — a **full Blender conversion run
a second time** for a selection the client already knew. The selection is stored on
the media, so it also survives job retries and later reprocessing.

Prim paths and variant names are **not** validated against the scene at this point:
it has not been analysed yet. They are filtered at conversion time against the
variant sets actually found, so an invented value is dropped rather than breaking
the job. The field only applies to `MODEL_3D`; sending it with a video or an image
is refused (`USD_NOT_3D`) rather than silently ignored.

See [3D & USD](../admin-guide/3d-usd.md) for what the conversion does with it.

## Idempotency

Write endpoints accept `Idempotency-Key`. The key is **reserved before** the request
runs, so a fast retry — or a second farm worker — cannot slip through and create a
duplicate:

- replay of a completed request → the original response, with `Idempotency-Replayed: true`;
- replay while the first is still running → `409 IDEMPOTENCY_IN_PROGRESS`;
- failed requests release the key, so a legitimate retry can succeed.

Keys are kept 24 h. They are scoped per token and per endpoint.

Creation endpoints (`ensure`) are idempotent by nature: they return `201` with
`created: true` on first call, `200` with `created: false` afterwards.

## Events

Two ways to consume them, for two studio realities.

**Push** — outgoing webhooks, signed HMAC-SHA256 (`POST /api/admin/webhooks`, see
[Identity & API](../admin-guide/identity-and-api.md)). Suited to a bot reachable
from the internet.

**Pull** — the event journal, for a daemon behind a studio firewall that nothing can
reach from outside:

```bash
curl -H "Authorization: Bearer $TOKEN" "$REVIEW/api/v1/events?since=$CURSOR&limit=100"
```

The client keeps the returned `cursor` and passes it back. Nothing is lost across a
restart, nothing is read twice. A first call **without** `since` returns an empty
page and the current cursor, rather than replaying a month of history.

Catalogue (also served by `GET /api/v1/schema`):

```
project.created     project.updated
sequence.created    shot.created        shot.updated       asset.created
task.created        task.updated        task.status_changed  task.assigned
version.created     version.published
media.uploaded      media.published     media.failed
review.decision     comment.created     comment.resolved
```

Events are retained 30 days, then purged by the daily sweep.

## Discovering an instance

`GET /api/v1/schema` returns the enumerations this instance accepts *and* the
studio's custom review statuses — which is what a review decision references. Read
it at startup instead of hard-coding values that diverge at the first change.

`GET /api/v1/me` returns the effective identity, the expanded scopes of the
presented token, and the project it is bound to.

## Errors

Same envelope as the rest of the API: `{ "error": "…", "code": "…" }`. Codes worth
handling: `SCOPE_REQUIRED`, `TOKEN_PROJECT_SCOPE`, `VERSION_EXISTS`, `KIND_UNKNOWN`,
`PATH_TOO_SHALLOW`, `USD_NOT_3D`, `IDEMPOTENCY_IN_PROGRESS`, `PROJECT_ARCHIVED`, and
the `*_NOT_FOUND` family.

Rate limit: 10 000 requests / 15 min for `/api/v1`, separate from the web quota.

## Related pages

- [API overview](overview.md) — conventions shared with `/api`
- [Domains](domains.md) — route map of the web API
- [Authentication & API access](authentication.md)
