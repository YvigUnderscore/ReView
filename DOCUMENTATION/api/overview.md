# API overview

> Updated: 2026-08-22

The backend is an Express 5 REST API under **`/api`**, with Socket.io realtime on
`/socket.io`. An **interactive reference** (OpenAPI 3.0 generated from the Zod schemas,
rendered with Scalar) is served by the backend at **`/api/docs`**
(spec: `/api/openapi.json`). Both are public in read: they describe the shape of the
API, not its data.

Two surfaces share that base:

- **`/api`** — what the web interface consumes. It follows the product.
- **`/api/v1`** — the stable surface for tools (DCC, Prism, bots, third-party
  synchronisation): pipeline-path addressing, idempotent writes, explicit scopes.
  See [API v1 — pipeline integration](v1-integration.md).

Two endpoints sit **outside** `/api`:

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Liveness probe. Always `{ "status": "ok" }` — it checks nothing else |
| `GET /metrics` | Prometheus text format, optionally guarded by `METRICS_TOKEN` |

```bash
curl -s http://localhost:3430/health
```

```json
{ "status": "ok" }
```

## Authentication

- `POST /api/auth/login` returns a **JWT access token** (+ refresh token), bound to
  a **revocable session**; scripts use **API tokens** (`rvk_` + 40 hex characters,
  fine-grained scopes), which open **`/api/v1` only** — pointed at `/api` they get
  `403 API_TOKEN_V1_ONLY`. 2FA (TOTP) and SSO (OIDC) are supported. Full reference:
  [Authentication & API access](authentication.md).
- Send `Authorization: Bearer <token>` on every request — the header, never the query
  string.
- Public exceptions: the setup flow (`/api/setup`) on an empty database, the login and
  SSO endpoints, invitation activation (`/api/auth/invitation/:token`), the
  unsubscribe endpoint (`/api/unsubscribe`), the ShotGrid webhook receiver
  (HMAC-authenticated), the API documentation, and the client share routes
  (`/api/client/*`) which authenticate with a **share link token**.

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3430/api/projects
```

## Conventions

- **All inputs are validated with Zod** (body, query, params) before any handler runs.
  Invalid input → `400` with per-field details.
- **RBAC everywhere**: routes check the user's role (`ADMIN` / `SUPERVISOR` / `ARTIST`
  / `CLIENT`), and reads are filtered by project membership; cross-project ids return
  `404`/`403` rather than leaking.
- JSON casing is `camelCase`; ids are integers; dates are ISO-8601 strings.
- Request bodies are capped at **2 MB** (`express.json`) — media bytes never transit
  through the API. The ShotGrid webhook receiver accepts up to 5 MB of raw body.
- Mutations return the updated entity; media links use **presigned MinIO URLs** with a
  limited lifetime (1 h for reads, 15 min for uploads).
- Deletions are soft by default (`deletedAt`); a permanent purge is a separate,
  explicit call.

### Pagination

Paginated collections take `page` and `pageSize` and answer with a fixed envelope:

```json
{ "items": [], "total": 0, "page": 1, "pageSize": 100 }
```

On `/api/v1`, `page` defaults to `1` (minimum `1`) and `pageSize` to `100`
(`1`–`100`). Not every collection is paginated — the per-endpoint shape is in
`/api/docs`.

## Errors

Errors are structured JSON. There are three distinct shapes:

```json
{ "error": "Human message", "code": "STABLE_CODE" }
```

```json
{ "error": "Validation échouée", "details": { "email": ["Invalid email"] } }
```

```json
{ "error": "Erreur interne du serveur" }
```

**Branch on `code`, never on `error`.** The `code` field is stable; the message is
human-facing and part of it is still French. Zod validation failures carry `details`
and **no `code`**; unexpected server errors carry neither — they are logged with pino
under a request id and never leak a stack trace.

| Status | Meaning |
|--------|---------|
| 400 | Validation failed (`details`), or a rejected value (`INVALID_FILE`, `KIND_UNKNOWN`…) |
| 401 | Missing token (`TOKEN_REQUIRED`), revoked session (`SESSION_REVOKED`), deleted account (`USER_GONE`) |
| 403 | Malformed/invalid JWT (`TOKEN_INVALID`), revoked API token (`API_TOKEN_INVALID`), API token used outside `/api/v1` (`API_TOKEN_V1_ONLY`), missing scope (`SCOPE_REQUIRED`, `SCOPE_WRITE_REQUIRED`, `TOKEN_PROJECT_SCOPE`), insufficient role, membership, quota (`STORAGE_LIMIT`, `PROJECT_QUOTA`) or publish-lock violation (`PUBLISHED_LOCKED`) |
| 404 | Not found, or not accessible to you |
| 409 | Conflict (`ALREADY_SETUP`, `IDEMPOTENCY_IN_PROGRESS`, the `*_IN_TRASH` family) |
| 429 | Rate limit exceeded, or too many concurrent uploads (`TOO_MANY_UPLOADS`) |
| 500 | Unexpected server error (logged with pino) |

Note the asymmetry inherited from the auth middleware: a **missing** token is `401`,
an **invalid** one is `403`.

## Rate limits

Limits are counted over a 15-minute window in **Redis** (atomic `INCR` + `PTTL`), so they
survive a restart and are shared by every API replica. The key is the authenticated
account when there is one, the IP otherwise — a whole studio behind one NAT no longer
shares a single budget. Exceeding a limit returns `429` with a plain `{ "error": "…" }`
body.

| Scope | Limit |
|-------|-------|
| `/api` (global) | 6 000 / 15 min per signed-in account, 5 000 / 15 min per anonymous IP |
| `/api/v1` | 10 000 / 15 min (separate budget, so a polling daemon cannot starve the UI) |
| `/api/setup` | 10 / 15 min |
| `/api/share` and `/api/client` | 300 / 15 min |
| `/api/auth` login, register, invitation | 50 / 15 min |
| `GET /metrics`, `GET /health` | not rate-limited |

## Realtime

Socket.io is served on the same origin at `/socket.io` and pushes presence,
notifications, media processing status, project rooms and live review state. It runs on
the Redis adapter, so several API replicas share the same rooms.

## Related pages

- [Authentication & API access](authentication.md) — sessions, 2FA, SSO, tokens, webhooks
- [API v1 — pipeline integration](v1-integration.md) — surface for DCC/pipeline tools
- [Python client & DCC integrations](python-client.md) — the client shipped in `clients/`
- [Domains](domains.md) — route map per feature
- [Security model](../infrastructure/security.md)
- [Monitoring & operations](../infrastructure/monitoring.md)
