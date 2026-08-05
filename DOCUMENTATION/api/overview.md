# API overview

> Updated: 2026-08-05

The backend is an Express 5 REST API under **`/api`**, with Socket.io realtime on
`/socket.io`. An **interactive reference** (OpenAPI generated from the Zod schemas,
rendered with Scalar) is served by the backend at **`/api/docs`**
(spec: `/api/openapi.json`).

Two surfaces share that base:

- **`/api`** — what the web interface consumes. It follows the product.
- **`/api/v1`** — the stable surface for tools (DCC, Prism, bots, third-party
  synchronisation): pipeline-path addressing, idempotent writes, explicit scopes.
  See [API v1 — pipeline integration](v1-integration.md).

## Authentication

- `POST /api/auth/login` returns a **JWT access token** (+ refresh token), bound to
  a **revocable session** ; scripts use **personal API tokens** (`rvk_…`, read/write
  scopes). 2FA (TOTP) and SSO (OIDC) are supported. Full reference:
  [Authentication & API access](authentication.md).
- Send `Authorization: Bearer <token>` on every request.
- Public exceptions: the setup flow (`/api/setup`) on an empty database, the SSO
  endpoints, and the client share routes (`/api/client/*`) which authenticate with
  a **share link token** instead of a JWT.

## Conventions

- **All inputs are validated with Zod** (body, query, params). Invalid input →
  `400` with field details.
- **RBAC everywhere**: routes check the user's role, and reads are filtered by
  project membership; cross-project IDs return `404`/`403` rather than leaking.
- JSON casing is `camelCase`; ids are integers; lists use explicit pagination
  where relevant.
- Mutations return the updated entity; media links use **presigned MinIO URLs**
  with limited lifetime.

## Errors

Errors are structured JSON:

```json
{ "error": "message", "code": "OPTIONAL_CODE" }
```

| Status | Meaning |
|--------|---------|
| 400 | Validation failed (`details` contains field errors) |
| 401 | Missing/expired token |
| 403 | Insufficient role, membership, or publish-lock violation |
| 404 | Not found (or not accessible to you) |
| 409 | Conflict (duplicates…) |
| 500 | Unexpected server error (logged with pino) |

## Related pages

- [API v1 — pipeline integration](v1-integration.md) — surface for DCC/pipeline tools
- [Domains](domains.md) — route map per feature
- [Security model](../infrastructure/security.md)
