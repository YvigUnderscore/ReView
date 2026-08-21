# Security model

> Updated: 2026-08-21

## Authentication & sessions

- JWT access tokens (`JWT_EXPIRES_IN`, default 7 d) + refresh tokens
  (`JWT_REFRESH_EXPIRES_IN`, default 30 d), signed with `JWT_SECRET`. Production boot
  **rejects weak or default secrets** (≥ 32 characters, no `change_me`-style value).
- Every login creates a **revocable session** whose id is embedded in both tokens.
  Revocation takes effect within 30 s (the validity cache TTL). Admins can revoke a
  single session or every session of an account.
- All application tokens (access, refresh, 2FA exchange, share session, OIDC state) are
  signed with the same secret, so the auth middleware filters by **allow-list**: only a
  token with no `kind` and a numeric `id` authenticates a request. A new token type
  added tomorrow is refused by default.
- Passwords are bcrypt-hashed with cost 12 and must be 8–128 characters with at least
  one letter and one digit. Auth events are audited.
- Optional TOTP 2FA with hashed one-time backup codes; the TOTP secret is stored
  encrypted (AES-GCM, `APP_ENCRYPTION_KEY` or derived from `JWT_SECRET`). The
  verification endpoint is limited to 15 attempts / 15 min per IP.
- Optional OIDC SSO, with an SSO-only mode that makes password sign-in return
  `403 PASSWORD_LOGIN_DISABLED`.
- **Self-registration is closed by default** (`ALLOW_SELF_REGISTRATION=false`). Opening
  it on an internet-facing instance hands an authenticated account to anyone, and lets
  an attacker pre-book a colleague's email address before their first SSO login — which
  OIDC would then match to that account.
- Public surfaces without a JWT: `/api/setup` (empty database only), the login/SSO
  endpoints, invitation activation, `/api/unsubscribe`, the ShotGrid webhook receiver
  (HMAC-verified on the raw body), the API documentation, and `/api/client/*`
  (share-token gated).

## Authorization

- **RBAC middleware on every route** (`ADMIN` / `SUPERVISOR` / `ARTIST` / `CLIENT`) plus
  **project-membership filtering on every read** — cross-project ids behave as
  not-found (no IDOR).
- **All inputs validated with Zod** (body/query/params) before any handler runs.
- The **publish lock** is enforced server-side (`403 PUBLISHED_LOCKED`), not just hidden
  in the UI.
- API tokens add a third dimension: fine-grained scopes checked route by route on
  `/api/v1`, a coarse write gate on `/api`, and an optional binding to a single project
  (`403 TOKEN_PROJECT_SCOPE`). A scope never grants more than its bearer's role and
  memberships already allow.
- Service accounts (`User.isService`) carry a random password that is never
  communicated and are explicitly refused at login; they can never be `ADMIN`.
- A router mounted on `/api` must **never** call `router.use(authenticate)`: Express
  runs it for every request crossing the mount point, public routes included. Attach
  authentication route by route.
- Share links: revocable, optional expiry and password, `VIEW`/`COMMENT` scoping, only
  ever exposing published and ready media.

## Data & storage

- Media bytes never transit through the API: **presigned MinIO URLs**, issued after
  RBAC checks, valid 15 min for uploads and 1 h for reads.
- The client-supplied `Content-Type` is normalised before signing, and the definitive
  type is set server-side at finalize. Because S3 only signs the `host` header, the
  browser could still send another one — so the production nginx serves the storage
  path with `Content-Security-Policy: sandbox; default-src 'none'; frame-ancestors 'none'`,
  which neutralises any active content in an uploaded object.
- Uploads are validated by **magic bytes** at finalize (`400 INVALID_FILE`); a rejected
  file is deleted from storage immediately.
- 3D archives are extracted behind explicit guards against path traversal and
  decompression bombs: `ARCHIVE_MAX_ENTRIES` (20 000),
  `ARCHIVE_MAX_UNCOMPRESSED_BYTES` (8 GiB), `ARCHIVE_MAX_COMPRESSION_RATIO` (200).
  External converters are killed after `MODEL_CONVERT_TIMEOUT_MS` (15 min).
- Optional ClamAV scanning of every upload; detections quarantine the object, fail the
  media and audit `MEDIA_QUARANTINED`.
- Rich-text input is sanitized server-side (`lib/sanitize`).
- Soft-delete everywhere; permanent purge is an explicit admin action or the retention
  sweep.
- Every media consultation is journaled (deduplicated per 30 min) and browsable in
  *Admin → Maintenance → Media access*.

## Outbound requests (SSRF)

The worker sits inside the internal network, where MinIO, Redis and PostgreSQL are
reachable without network authentication. Anything that lets a user choose an outbound
URL is therefore guarded:

- Webhook targets are validated at creation (`400 BAD_WEBHOOK_URL` for private,
  loopback, link-local, short internal names or non-HTTP schemes) **and re-checked at
  delivery time after DNS resolution**, because a public name can point at `127.0.0.1`
  or `169.254.169.254`. Redirects are refused rather than followed, and each delivery
  has a 10 s timeout.
- The ShotGrid client refuses non-HTTPS and non-public addresses. The single escape
  hatch, `SHOTGRID_INSECURE_HOSTS`, exists for the development simulator and is logged
  as a warning at **every** boot so it cannot be forgotten in production.

## Secrets

- `JWT_SECRET`, MinIO, SMTP and Grafana credentials live in `.env` — never commit it.
- Stored secrets (SMTP password, webhook HMAC secrets, per-account TOTP secrets) are
  encrypted at rest with `APP_ENCRYPTION_KEY`, or a key derived from `JWT_SECRET` when
  it is unset. If you set it, production applies the same strength rule as to
  `JWT_SECRET`.
- Secrets shown once and never again: API tokens (`rvk_…`), service tokens, webhook
  HMAC secrets, 2FA backup codes. Only hashes or ciphertext are stored.
- Log objects are redacted (`password`, `secret`, `apiKey`, `accessToken`, plus one and
  two levels of nesting) and replaced with `[Redacted]`.
- Production compose makes `POSTGRES_PASSWORD`, `MINIO_ROOT_USER`,
  `MINIO_ROOT_PASSWORD`, `JWT_SECRET`, `CORS_ORIGIN` and `S3_PUBLIC_ENDPOINT`
  mandatory, and `config/env.ts` re-checks them at boot.

## Transport & headers

- In production, `docker-compose.prod.yml` puts a TLS-terminating nginx in front and
  removes every host port from `frontend`, `backend` and `minio`. MinIO is reachable
  only through `https://<domain>/<bucket>/`; its console requires an SSH tunnel or a
  VPN.
- `helmet` is applied on the API, with `crossOriginResourcePolicy: cross-origin` so the
  SPA can consume storage responses. `trust proxy` is set to 1 hop, which is what makes
  per-IP rate limiting meaningful behind nginx.
- Each nginx location sets its own CSP: a strict `default-src 'self'` policy for the
  SPA, a `sandbox` policy for the storage path. `Permissions-Policy` disables camera,
  microphone and geolocation.
- The API documentation page (`/api/docs`) carries a scoped CSP allowing only its CDN
  assets.
- `CORS_ORIGIN=*` is rejected in production; the value is a comma-separated list of
  exact origins, and the same list drives the MinIO bucket CORS rules.

## Rate limiting

Counted per IP over a 15-minute window, in memory:

| Scope | Limit |
|-------|-------|
| `/api` | 5 000 |
| `/api/v1` | 10 000 |
| `/api/setup` | 10 |
| `/api/share`, `/api/client` | 300 |
| `/api/auth` login, register, invitation | 50 |
| `/api/auth/2fa/verify` | 15 |

The counter table is capped at 100 000 keys and **fails closed**: once full, a new key
is refused with `429` rather than clearing the table — clearing it would erase an
attacker's own counter and turn the memory guard into a limiter reset.

## Dependency audit — baseline 2026-07-18 (Phase 30, CP-SEC)

This is the last recorded audit, not a live figure. Re-run `npm audit` in `backend/`
and `frontend/` at every CP-SEC and update this section.

Toolchain: Node 22 images, Express 5, Prisma, Vite 7, React 19.

| Scope | State |
|-------|-------|
| Backend | **0 vulnerabilities** (fixed 2026-07-18: `adm-zip` ≥ 0.6.0, high — crafted-ZIP memory exhaustion; relevant because users upload 3D archives) |
| Frontend | **0 high/critical.** `lodash-es` forced to ≥ 4.18.1 via npm `overrides` (high, prototype pollution — transitive via Excalidraw's mermaid chain). 3 **moderate** accepted: `nanoid` 4.x pinned inside `@excalidraw/mermaid-to-excalidraw` (predictable IDs — only exercised by mermaid-to-diagram conversion; fix requires downgrading Excalidraw, not worth it). Re-check at each CP-SEC |

Third-party licences are tracked in `THIRD-PARTY-NOTICES.md`, regenerated by
`node scripts/generate-notices.mjs`, which refuses any licence outside the allow-list.
See [Licensing](../development/licensing.md).

## Known watch-points

- **Seed accounts** (`admin@review.local` / `admin1234`, `artist@review.local` /
  `artist1234`) use published passwords: development only.
- **`GET /metrics` is open when `METRICS_TOKEN` is unset.** It exposes route names,
  latencies and queue depth. Set the token, or keep the port off any routable network.
- **Grafana falls back to `admin`/`admin`** when `GRAFANA_ADMIN_PASSWORD` is unset. The
  loopback binding is the protection that does not depend on the operator; set the
  password anyway.
- **Rate limits are per process and in memory.** They reset on every backend restart,
  and would be per-replica if the backend were scaled — which it must not be, for
  several other reasons (see [Architecture](architecture.md#single-instance-assumptions)).
- **`UserSession` rows are never deleted.** Validity is enforced at read time, so
  expired and revoked sessions accumulate; the table grows without bound.
- **Audit entries are best-effort.** `logAudit` is fire-and-forget and swallows its
  errors, so a database blip loses audit lines for actions that otherwise succeeded.
- **`prisma db push --accept-data-loss` is the boot fallback** when `migrate deploy`
  fails, and `migrate deploy`'s stderr is discarded. A failed migration on a populated
  database can therefore drop columns without leaving a diagnostic in the container
  logs. Take a backup before every upgrade and check `prisma migrate status` after.
- **No graceful shutdown**: `SIGTERM` kills in-flight work. Drain before restarting.
- Extend rate limiting as new public endpoints appear (client/share).

## Related pages

- [API overview](../api/overview.md) — error codes and limits
- [Authentication & API access](../api/authentication.md)
- [Architecture](architecture.md) — failure modes and single-instance assumptions
- [Monitoring & operations](monitoring.md)
- [Users & roles (admin)](../admin-guide/users-and-roles.md)
- [Licensing](../development/licensing.md)
