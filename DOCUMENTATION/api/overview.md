# API overview

> Updated: 2026-07-18

The backend is an Express 5 REST API under **`/api`**, with Socket.io realtime on
`/socket.io`. An **interactive reference** (OpenAPI generated from the Zod schemas,
rendered with Scalar) is served by the backend at **`/api/docs`**
(spec: `/api/openapi.json`).

## Authentication

- `POST /api/auth/login` returns a **JWT access token** (+ refresh token).
- Send `Authorization: Bearer <token>` on every request.
- Access tokens expire (default 7 d) and are renewed with the refresh token
  (default 30 d).
- Public exceptions: the setup flow (`/api/setup`) on an empty database, and the
  client share routes (`/api/client/*`) which authenticate with a **share link
  token** instead of a JWT.

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

- [Domains](domains.md) — route map per feature
- [Security model](../infrastructure/security.md)
