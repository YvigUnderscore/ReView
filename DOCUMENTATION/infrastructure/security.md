# Security model

> Updated: 2026-07-18

## Authentication & sessions

- JWT access tokens (default 7 d) + refresh tokens (30 d), signed with
  `JWT_SECRET`. Production boot **rejects weak or default secrets**
  (≥ 32 random characters required).
- Passwords hashed server-side; auth events are audited.
- Public surfaces without JWT: `/api/setup` (empty database only) and
  `/api/client/*` (share-token gated).

## Authorization

- **RBAC middleware on every route** (`ADMIN` / `SUPERVISOR` / `ARTIST` /
  `CLIENT`) plus **project-membership filtering on every read** — cross-project
  IDs behave as not-found (no IDOR).
- **All inputs validated with Zod** (body/query/params) before any handler runs.
- The **publish lock** is enforced server-side (403), not just hidden in the UI.
- Share links: revocable, optional expiry, `VIEW`/`COMMENT` scoping, only ever
  exposing published+ready media.

## Data & storage

- Media bytes never transit through the API: **presigned MinIO URLs** with short
  lifetimes, issued after RBAC checks.
- Rich-text input is sanitized server-side (`lib/sanitize`).
- Soft-delete everywhere; permanent purge is an explicit admin action.

## Transport & headers

- In production, put a TLS-terminating proxy (nginx) in front of the stack.
- The API documentation page (`/api/docs`) carries a scoped CSP for its CDN
  assets; the SPA is served same-origin (nginx proxies `/api` and `/socket.io`).

## Dependency audit — baseline 2026-07-18 (Phase 30, CP-SEC)

Toolchain: Node 24.16, Express 5, Prisma, Vite 7, React 19.

| Scope | State |
|-------|-------|
| Backend | **0 vulnerabilities** (fixed 2026-07-18: `adm-zip` ≥ 0.6.0, high — crafted-ZIP memory exhaustion; relevant because users upload 3D archives) |
| Frontend | **0 high/critical.** `lodash-es` forced to ≥ 4.18.1 via npm `overrides` (high, prototype pollution — transitive via Excalidraw's mermaid chain). 3 **moderate** accepted: `nanoid` 4.x pinned inside `@excalidraw/mermaid-to-excalidraw` (predictable IDs — only exercised by mermaid-to-diagram conversion; fix requires downgrading Excalidraw, not worth it). Re-check at each CP-SEC. |

## Known watch-points

- `JWT_SECRET`, MinIO and SMTP credentials live in `.env` — never commit it.
- Seed accounts (`*@review.local`) use known passwords: development only.
- Rate limiting exists on sensitive routes (`middleware/rateLimit`); extend it as
  new public endpoints appear (client/share).

## Related pages

- [API overview](../api/overview.md)
- [Users & roles (admin)](../admin-guide/users-and-roles.md)
