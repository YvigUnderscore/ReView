# API overview

*The shape of every ReView call: two surfaces, one header, three error shapes, and the limits that bound them.*

> Updated: 2026-08-23

The backend is an Express 5 REST API served under **`/api`**, with Socket.io realtime on
`/socket.io`. Everything is JSON: media bytes never travel through it, they travel through
presigned MinIO URLs the API hands you.

This page is the contract that holds for every endpoint — where to send a call, how to
authenticate it, what a page of results looks like, what an error looks like, and what
stops you. The per-feature route map is in [Domains](domains.md); the integration surface
has its own page, [API v1](v1-integration.md).

## Two surfaces, and what sits outside them

`/api` and `/api/v1` are not two versions of the same thing. They are two contracts with
different promises.

| Surface | Promise | Who calls it |
|---------|---------|--------------|
| **`/api`** | Follows the product. Endpoints appear, change shape and disappear with the screens that consume them | The web interface |
| **`/api/v1`** | A stable contract: pipeline-path addressing, idempotent writes, explicit scopes. What is published there does not move without a version change | DCC tools, Prism, farm nodes, bots, third-party synchronisation |

Everything else — the probes, the metrics, the generated reference — sits outside both and
needs no session at all.

| Endpoint | Answers | Notes |
|----------|---------|-------|
| `GET /health` | Liveness | Also mounted at **`/api/health`** — see below |
| `GET /health/live` | Liveness, explicitly | Same body as `/health` |
| `GET /health/ready` | Readiness | `200` or **`503`**, with a per-dependency report |
| `GET /api/version` | `{ version, commit, builtAt, node, source }` | `source` is the AGPL source-code offer |
| `GET /metrics` | Prometheus text format | Guarded by `METRICS_TOKEN` when it is set |
| `GET /api/docs` | The interactive reference (Scalar) | Public in read |
| `GET /api/openapi.json` | The OpenAPI 3.0 document | Generated from the Zod schemas |

![Three kinds of caller reach the same Express application; the request crosses the logger, helmet and CORS, the raw-body ShotGrid receiver, the 2 MB JSON parser, the metrics endpoint and the global rate limiter, then lands on one of three surfaces: the web API, the versioned integration API, or the unauthenticated probes.](../assets/api/api-surfaces-and-tokens.svg)

> [!NOTE]
> `/api/docs` describes the shape of an API, not all of it. The generated document covers
> `/health`, `POST /api/auth/login`, the `/api/projects` collection and item, and **every**
> `/api/v1` route — those are auto-described from the v1 mount table, so a v1 endpoint
> cannot exist without appearing there. The eighty-odd other web routers are not in it;
> for those, [Domains](domains.md) is the map and the source is the reference.

## Proving who you are

Three credentials exist, and each one is sent in a header. Never in the query string: a URL
crosses application logs, the reverse proxy's logs, browser history and the `Referer`
header, where a header goes nowhere. The historical `?token=` fallback was removed from the
authentication middleware.

| Credential | Header | Opens |
|------------|--------|-------|
| **JWT session** | `Authorization: Bearer <jwt>` | `/api` and `/api/v1`, bounded by role and project membership |
| **API token** | `Authorization: Bearer rvk_<40 hex>` | `/api/v1` — the surface it is designed for |
| **Share session** | `X-Share-Auth: <jwt>` | `/api/client/:token` and its sub-routes, nothing else |

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3430/api/projects
```

A handful of routes are deliberately public: the first-run setup wizard (`/api/setup`, only
while the database has no studio), login and the SSO endpoints, invitation preview and
activation (`/api/auth/invitation/:token`), the unsubscribe endpoint (`/api/unsubscribe`),
the ShotGrid webhook receiver (authenticated by HMAC over the raw body), the documentation
endpoints, and the client share routes.

> [!WARNING]
> An API token is **documented** as opening `/api/v1` only, and `/api` is expected to
> answer `403 API_TOKEN_V1_ONLY`. The middleware that enforces it (`apiTokenSurface`) is
> written and unit-tested but **is not mounted** by `createApp()` today: an `rvk_` token
> currently reaches `/api/projects`, `/api/media/:id/url` and `/api/admin/*` as well — and
> a token bound to one project is *not* held to that binding there, because only the v1
> routes check it. Treat `/api/v1` as the only surface a token may aim at, and do not build
> an integration on the gap. Full detail in
> [Authentication & API access](authentication.md).

## Health, readiness and version

Liveness and readiness answer two different questions, and confusing them is how a studio
ends up restarting a healthy container because Postgres blinked.

**Liveness** — does the process still answer? No I/O, no dependency, never fails on
anything but a dead event loop. This is the probe `docker compose` uses.

```bash
curl -s http://localhost:3430/health
```

```json
{ "status": "ok", "version": "2.0.0", "commit": "f2573c0a91b4", "uptimeSec": 1843 }
```

**Readiness** — can this instance actually serve? Postgres, Redis and MinIO are each
probed under a **2 s** timeout, in parallel, and any failure turns the whole answer into a
`503` that a load balancer or an external monitor knows how to read.

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3430/health/ready
```

```json
{
  "status": "degraded",
  "version": "2.0.0",
  "commit": "f2573c0a91b4",
  "cached": false,
  "checks": {
    "database": { "ok": true, "ms": 3 },
    "redis":    { "ok": true, "ms": 1 },
    "storage":  { "ok": false, "ms": 2001, "error": "timeout after 2000ms" }
  }
}
```

The result is memoised for **5 s** and concurrent calls share one execution, so hammering
the probe costs at most one round trip per dependency per window — a readiness endpoint
that can be turned into a load vector is a liability, not a monitor.

| Route | Status codes | Body |
|-------|--------------|------|
| `GET /health`, `GET /health/live` | `200` only | `status`, `version`, `commit`, `uptimeSec` |
| `GET /health/ready` | `200` ready, `503` degraded | `status`, `version`, `commit`, `cached`, `checks` |
| `GET /api/health`, `/api/health/ready` | same | The **same router**, mounted twice |
| `GET /api/version` | `200` | `version`, `commit`, `builtAt`, `node`, `source` |

> [!IMPORTANT]
> The double mount is deliberate. The production nginx front end proxies only `/api/`,
> `/socket.io/` and `/review/` to the backend, so a plain `GET /health` through the public
> host was served by the SPA — `200 text/html`, "everything is fine", whatever the API was
> doing. **Probe `/api/health/ready` from outside**, and `/health` only from inside the
> container. See [Monitoring & operations](../infrastructure/monitoring.md).

## Conventions

- **Every input is validated by Zod** — body, query and params — before a handler runs.
  Invalid input never reaches the database; it comes back as a `400` with per-field
  details.
- **RBAC everywhere.** Routes check the caller's role (`ADMIN`, `SUPERVISOR`, `ARTIST`,
  `CLIENT`) and reads are filtered by project membership. An id from a project you do not
  belong to answers `404` or `403`, never a leaked row.
- **JSON casing is `camelCase`**, ids are integers, dates are ISO-8601 strings.
- **Request bodies are capped at 2 MB** (`express.json`). The only exception is the
  ShotGrid webhook receiver, mounted *before* the JSON parser with a 5 MB raw-body limit,
  because its HMAC signs the bytes as received and a reparsed body does not reproduce them.
- **Files never transit through the API.** Reads and writes go through **presigned MinIO
  URLs** — 1 h for a download, 15 min for an upload — which the API hands you on request.
- **Mutations return the updated entity**, so a client does not have to re-fetch to know
  what it just did.
- **Deletions are soft by default** (`deletedAt`, the trash); a permanent purge is a
  separate, explicit call.
- **Writes on `/api/v1` accept `Idempotency-Key`**, and a replayed key returns the first
  answer instead of creating a second entity. Detail in
  [API v1](v1-integration.md).
- **The Episode level is optional per project.** `/api/episodes` exists on every instance,
  but a project that has not switched it on answers `409 EPISODES_DISABLED` — a client
  should read `GET /api/episodes/settings?projectId=…` before showing the level.

> [!TIP]
> `GET /api/comments/export?scope=&id=&format=` is the read surface most integrations miss.
> `scope` is one of `media`, `version`, `shot`, `playlist`, `timeline`, `format` one of
> `csv`, `edl`, `otio`, `sheet`, and the answer is a file (`Content-Disposition:
> attachment`), rate-limited to **20 exports per minute per account**. A truncated export
> says so with an `X-Notes-Truncated: 1` header. See
> [Exporting notes](../user-guide/exporting-notes.md).

## Pagination

Collections are bounded. Two modes share one response envelope, and you pick per request.

**Offset mode** — `?page=2&pageSize=50&sort=name&order=asc`. The only mode that can jump
straight to page N, and the one an interface with page numbers needs. Sorting is
whitelisted per route and always broken by `id`, so two rows with the same `order` value
cannot swap between page 1 and page 2.

**Cursor mode** — `?cursor=<opaque>&pageSize=50`, offered by the large collections
(`/api/shots`, `/api/tasks`, `/api/assets`). The cursor comes from the previous answer's
`nextCursor` and, when supplied, **wins over `page`**. On a two-thousand-shot feature it is
the mode that neither duplicates nor skips a row when somebody creates a shot while you
are paging.

```json
{
  "items": [],
  "total": 1837,
  "page": 1,
  "pageSize": 100,
  "pageCount": 19,
  "hasMore": true,
  "nextCursor": "eyJrIjoibiIsInYiOjEyMCwiaSI6NDQ4fQ"
}
```

| Field | Meaning |
|-------|---------|
| `items` | The page itself |
| `total` | Rows matching the filter, ignoring the page |
| `page`, `pageSize` | Echoed back, after coercion and clamping |
| `pageCount` | `ceil(total / pageSize)`, at least `1` — the client does not redo the rounding |
| `hasMore` | Is there anything after this page |
| `nextCursor` | **Cursor collections only.** `null` means end of list |

| Rule | `/api` | `/api/v1` |
|------|--------|-----------|
| `page` | integer ≥ 1, default `1` | integer ≥ 1, default `1` |
| `pageSize` | `1`–**`500`**, default `100` | `1`–`100`, default `100` |
| `order` | `asc` / `desc`, default `desc` | `asc` / `desc`, default `desc` |
| Cursor | On the large collections | Not offered |

> [!NOTE]
> A cursor that is truncated, forged, or left over from an older release is treated as
> **absent**: the list restarts from the beginning rather than answering `500` for a
> parameter no human typed. If a paging loop silently starts over, that is the symptom to
> look for. Some routes serve a larger default page than 100 when a screen consumes them
> whole (a sequence tree, an upload destination list) — an explicit `pageSize` always wins.

## Errors

Errors are structured JSON, and there are three shapes.

```json
{ "error": "This token is scoped to another project", "code": "TOKEN_PROJECT_SCOPE" }
```

```json
{ "error": "Validation failed", "code": "VALIDATION_FAILED", "details": { "email": ["Invalid email"] } }
```

```json
{ "error": "Trop de requêtes, réessayez plus tard." }
```

**Branch on `code`, never on `error`.** The code is the stable identifier — the web
interface uses it as a translation key, and an integration should treat it the same way.
The message exists for logs and for integrators: it is English in the error factory and in
the global handler, but a handful of strings written before that rule still come back in
French, the rate limiters among them.

The third shape is the one to plan for: **a code is not guaranteed**. The error factory
only attaches its fallback code when the caller gave no message, on the reasoning that
`Media not found` says more than a generic `NOT_FOUND` would — so most `404`s carry a
message and nothing else, and the rate limiters carry a message alone by design. When
there is no code, the status plus the message is all you get.

![A decision tree: a 2xx body is the resource itself; a body carrying details is a Zod validation failure with code VALIDATION_FAILED; a body carrying a code is a typed error to branch on; a body with neither is the message-only shape used by the limiters and by most 404s.](../assets/api/error-envelope-decision.svg)

| Status | What it means | Codes you will actually meet |
|--------|---------------|------------------------------|
| 400 | Validation failed, or a value the domain refuses | `VALIDATION_FAILED` (with `details`), `FILE_TOO_LARGE`, `INVALID_FILE`, `KIND_UNKNOWN`, `UNKNOWN_SCOPE`, `BAD_WEBHOOK_URL` |
| 401 | You are not authenticated, or no longer are | `TOKEN_REQUIRED`, `SESSION_REVOKED`, `USER_GONE`, `BAD_CREDENTIALS`, `CURRENT_PASSWORD_REQUIRED` |
| 403 | Authenticated, but not allowed | `TOKEN_INVALID`, `API_TOKEN_INVALID`, `API_TOKEN_V1_ONLY`, `SCOPE_REQUIRED`, `SCOPE_WRITE_REQUIRED`, `TOKEN_PROJECT_SCOPE`, `PUBLISHED_LOCKED`, `STORAGE_LIMIT`, `PROJECT_QUOTA`, `PASSWORD_LOGIN_DISABLED` |
| 404 | Not found, or not yours to see | Usually **no code** — `NOT_FOUND` only when the handler wrote no message |
| 409 | Conflict with the current state | `ALREADY_SETUP`, `EPISODES_DISABLED`, `IDEMPOTENCY_IN_PROGRESS`, the `*_IN_TRASH` family |
| 429 | Rate limit, or too many concurrent uploads | `TOO_MANY_UPLOADS`; the limiters themselves send no code |
| 500 | Unexpected — logged with pino under the request id | `INTERNAL_ERROR`, never a stack trace |

Note the asymmetry inherited from the authentication middleware: a **missing** token is
`401 TOKEN_REQUIRED`, an **invalid** one is `403 TOKEN_INVALID`. A typed error may carry
extra top-level fields beyond `error` and `code` when the interface needs them to offer a
next step — for instance the ShotGrid creation link returned when local creation is locked.

## Rate limits

Counters live in **Redis** (atomic `INCR` plus `PTTL`), so they survive a restart and are
shared by every API replica — bringing a container down is not a way to refill an
anti-brute-force budget. Each limiter has its own key space, and the key is the
**authenticated account** when the request carries a valid session JWT, the IP otherwise:
a whole studio behind one NAT no longer shares one budget. Opaque `rvk_` tokens are counted
by IP, which is why `/api/v1` has a separate allowance.

| Scope | Window | Limit |
|-------|--------|-------|
| `/api` (global) | 15 min | **6 000** per signed-in account, **5 000** per anonymous IP |
| `/api/v1` | 15 min | **10 000**, a separate budget so a polling daemon cannot starve the interface |
| `/api/auth` login, register, invitation | 15 min | 50 per IP |
| `POST /api/auth/2fa/verify` | 15 min | 15 per IP |
| `POST /api/client/:token/unlock` | 15 min | 10 per IP **and per link** |
| `/api/share`, `/api/client` | 15 min | 300 per IP |
| `/api/setup` | 15 min | 10 per IP |
| `/api/unsubscribe` | 15 min | 60 per IP |
| `GET /api/search` | 1 min | 120 per account |
| `GET /api/comments/export` | 1 min | 20 per account |
| ShotGrid webhook receiver | 1 min | 600 per IP |
| `/health*`, `/api/version`, `/metrics` | — | Not rate-limited |

> [!CAUTION]
> The limiter **fails closed**. If Redis stops answering, requests are refused with `429`
> rather than waved through: a counter that cannot count must not become the way to bypass
> the counter. A sudden flood of `429` with no traffic spike is a Redis incident, not an
> abusive client — check [Monitoring](../infrastructure/monitoring.md).

## Realtime

Socket.io is served on the same origin at `/socket.io`, on the Redis adapter, so several
API replicas share the same rooms. Put the credential in `socket.handshake.auth.token` — a
session JWT, or a share link token for a client page, which additionally needs its
`shareAuth` once the link is password-protected. A `?token=` query is still accepted by the
handshake for older clients, and is the one place it survives; prefer `auth`, which does not
end up in a proxy log. The same checks as the HTTP middleware apply: a revoked session, a
deleted account and a downgraded role all take effect on the socket too.

| Room | Joined by | Carries |
|------|-----------|---------|
| `user_<id>` | Automatically, on connect | `notification:new`, chat events (`chat:message`, `chat:read`, `chat:conversation`…) |
| `project_<id>` | On entering a project | `shot:update`, `sequence:update`, `asset:update`, `task:update`, `version:update`, `media:update`, `board:update`, `timeline:update`, `shotgrid:sync` |
| `review_<mediaId>` | `join_review` / `leave_review` | `review:presence` (who is watching), `comment:new`, `comment:update`, `comment:delete`, `comment:reaction` |
| `live_<key>` | `live:join` | `live:state` and `live:sync` — the live review room, relayed only from the driver |

Presence is counted per connection, not per account, so two tabs are two entries and an
orphaned one expires on its own. RBAC is re-checked at every join: a socket is never a way
around project membership.

## Related pages

- [Authentication & API access](authentication.md) — sessions, 2FA, SSO, tokens, share
  links, webhooks
- [API v1 — pipeline integration](v1-integration.md) — pipeline paths, scopes, idempotency,
  the event journal
- [Python client & DCC integrations](python-client.md) — the client shipped in `clients/`
- [Domains](domains.md) — the route map, feature by feature
- [Security model](../infrastructure/security.md)
- [Monitoring & operations](../infrastructure/monitoring.md)
