# Authentication & API access

> Updated: 2026-08-22

Three ways to authenticate against the REST API:

| Method | Header | For |
|--------|--------|-----|
| **JWT session** | `Authorization: Bearer <jwt>` | The web app (login/refresh), all of `/api` |
| **API token** | `Authorization: Bearer rvk_<40 hex>` | Scripts & integrations, **`/api/v1` only** |
| **Share session** | `X-Share-Auth: <jwt>` | Public client share pages only |

Tokens travel in the **header, never in the query string**: a URL crosses application
logs, the reverse proxy's logs, the browser history and the `Referer` header, where a
header goes nowhere.

Examples below assume:

```bash
export REVIEW="https://review.mystudio.com"
```

## JWT sessions (interactive)

### Sign in

```bash
curl -s -X POST "$REVIEW/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{ "email": "nina@mystudio.com", "password": "•••••••••" }'
```

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…",
  "user": { "id": 5, "email": "nina@mystudio.com", "name": "Nina", "role": "ARTIST" }
}
```

Every login creates a **revocable session**; its id (`sid`) is embedded in both tokens.
Access tokens live `JWT_EXPIRES_IN` (default `7d`), refresh tokens
`JWT_REFRESH_EXPIRES_IN` (default `30d`).

If the account has 2FA enabled the response is `{ "requires2fa": true, "tmpToken": "…" }`
instead (see below). Failures:

| Status | Body | When |
|--------|------|------|
| 401 | `{ "error": "Identifiants invalides", "code": "BAD_CREDENTIALS" }` | Wrong email/password, or a service account trying to sign in |
| 403 | `{ "error": "Password sign-in is off — use SSO", "code": "PASSWORD_LOGIN_DISABLED" }` | The studio is in SSO-only mode |
| 429 | `{ "error": "Trop de requêtes, réessayez plus tard." }` | More than 50 attempts / 15 min from one IP |

### Refresh

```bash
curl -s -X POST "$REVIEW/api/auth/refresh" \
  -H "Content-Type: application/json" \
  -d '{ "refreshToken": "eyJhbGciOi…" }'
```

```json
{ "token": "eyJhbGciOi…", "refreshToken": "eyJhbGciOi…" }
```

Requires the session to still be active (revoked or expired →
`401 SESSION_REVOKED`) and slides its expiry. Note the response carries **no `user`**.

### Sessions

- `POST /api/auth/logout` → `204`. Revokes the current session; both tokens die with
  it (enforced by the auth middleware with a ≤ 30 s cache).
- `GET /api/auth/sessions` lists the account's active sessions:

  ```json
  {
    "sessions": [
      {
        "id": "6f1c9b2e4a7d43f0b58c1e9a2d3f4c5b",
        "userAgent": "Mozilla/5.0 …",
        "ip": "10.0.0.14",
        "createdAt": "2026-08-19T08:02:11.004Z",
        "lastSeenAt": "2026-08-21T09:55:00.812Z",
        "current": true
      }
    ]
  }
  ```

- `DELETE /api/auth/sessions/:sid` revokes one (`204`; the id is exactly 32
  characters). Admins can revoke everything for a user with
  `DELETE /api/users/:id/sessions` (offboarding), or one session studio-wide with
  `DELETE /api/admin/sessions/:sid`.

### Registration and invitations

Open sign-up is **closed by default**. `POST /api/auth/register` answers
`403 { "code": "REGISTRATION_DISABLED" }` unless `ALLOW_SELF_REGISTRATION=true`; it
creates an `ARTIST`. Passwords are 8–128 characters with at least one letter and one
digit, hashed with bcrypt (cost 12).

The normal path is an administrator invitation, activated on two public routes:

```bash
curl -s "$REVIEW/api/auth/invitation/$INVITE_TOKEN"          # preview shown on the activation page
curl -s -X POST "$REVIEW/api/auth/invitation/$INVITE_TOKEN" \
  -H "Content-Type: application/json" -d '{ "password": "chosen-pass-9" }'
```

The `POST` returns the same `{ token, refreshToken, user }` triple as a login —
choosing your password signs you in. Both routes share the 50 / 15 min limiter.
Sending an invitation requires `APP_URL` **and** a working SMTP configuration,
otherwise the admin gets `400 APP_URL_MISSING` or `400 SMTP_NOT_CONFIGURED` up front,
and `400 SMTP_SEND_FAILED` if the relay refuses the message.

### Current user

```bash
curl -s -H "Authorization: Bearer $JWT" "$REVIEW/api/auth/me"
```

```json
{ "user": { "id": 5, "email": "nina@mystudio.com", "name": "Nina", "role": "ARTIST", "twoFaEnabled": false } }
```

### Authentication failures

| Status | `code` | Cause |
|--------|--------|-------|
| 401 | `TOKEN_REQUIRED` | No `Authorization` header and no `?token=` |
| 403 | `TOKEN_INVALID` | Signature invalid, expired, or the wrong kind of token (refresh, 2FA, share…) |
| 401 | `SESSION_REVOKED` | The session behind the token was revoked or expired |
| 401 | `USER_GONE` | The account no longer exists |
| 403 | `API_TOKEN_INVALID` | API token unknown, revoked or expired |
| 403 | `SCOPE_WRITE_REQUIRED` | API token with no write scope on a non-`GET`/`HEAD`/`OPTIONS` request |

## Two-factor authentication (TOTP)

Enrollment, authenticated:

```bash
curl -s -X POST "$REVIEW/api/auth/2fa/setup" -H "Authorization: Bearer $JWT"
```

```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "otpauth": "otpauth://totp/Mystudio:nina@mystudio.com?secret=JBSWY3DPEHPK3PXP&issuer=Mystudio"
}
```

Render the `otpauth://` URI as a QR code, then confirm with a code from the app:

```bash
curl -s -X POST "$REVIEW/api/auth/2fa/enable" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{ "code": "492013" }'
```

```json
{ "enabled": true, "backupCodes": ["3f9a1c4e02", "…"] }
```

Ten one-time backup codes, shown **once**, stored hashed. Calling `/setup` again while
2FA is already on returns `400 TWOFA_ALREADY_ENABLED`; a wrong code returns
`401 TWOFA_BAD_CODE`.

Login with 2FA is a two-step exchange. `POST /api/auth/login` answers
`{ "requires2fa": true, "tmpToken": "…" }` — that token is valid **5 minutes** —
then:

```bash
curl -s -X POST "$REVIEW/api/auth/2fa/verify" \
  -H "Content-Type: application/json" \
  -d '{ "tmpToken": "eyJhbGciOi…", "code": "492013" }'
```

Returns the normal `{ token, refreshToken, user }`. `code` accepts the TOTP **or** an
unused backup code (then consumed permanently). An expired `tmpToken` gives
`401 TWOFA_TOKEN_EXPIRED`. This endpoint has its own limiter: **15 attempts /
15 min per IP**.

`POST /api/auth/2fa/disable { password }` turns it off and returns
`{ "enabled": false }`.

The TOTP secret is stored encrypted (AES-GCM, key = `APP_ENCRYPTION_KEY` or derived
from `JWT_SECRET`); audit events cover `TWOFA_ENABLE`, `TWOFA_DISABLE`, `TWOFA_FAIL`
and `TWOFA_BACKUP_USED`.

## SSO (OIDC)

When configured by an admin (*Admin → Studio → Identity (SSO)*), the login page shows
an SSO button:

- `GET /api/auth/oidc/status` (public) → `{ "enabled": true, "label": "Studio SSO" }`.
- `GET /api/auth/oidc/login` redirects to the provider (authorization code flow;
  state + nonce carried in a short-lived signed httpOnly cookie).
- `GET /api/auth/oidc/callback` exchanges the code, requires a **verified email**,
  matches the account by email (optional auto-provisioning as Artist), honours 2FA
  (redirects into the same code step), and hands tokens to the SPA via the URL
  **fragment** (never sent to any server).

SSO-only mode makes password sign-in return `403 PASSWORD_LOGIN_DISABLED` — including
for self-registration, so nobody can pre-book a colleague's email address before their
first OIDC login.

## API tokens

Format: `rvk_` followed by 40 hexadecimal characters. Only the SHA-256 hash is stored;
`lastUsedAt` is refreshed at most once per minute per token.

### Personal tokens

Created from the profile page, or:

```bash
curl -s -X POST "$REVIEW/api/auth/tokens" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{
        "name": "nuke-publish",
        "description": "Laptop publish shelf",
        "scopes": ["versions:write", "media:write"],
        "expiresInDays": 90,
        "projectId": 3
      }'
```

`201 Created`:

```json
{
  "token": "rvk_0123456789abcdef0123456789abcdef01234567",
  "apiToken": {
    "id": 7, "name": "nuke-publish", "description": "Laptop publish shelf",
    "kind": "PERSONAL", "scopes": ["versions:write", "media:write"],
    "projectId": 3, "lastUsedAt": null,
    "expiresAt": "2026-11-19T09:14:02.311Z",
    "createdAt": "2026-08-21T09:14:02.311Z"
  }
}
```

The plaintext `token` is returned **once**. Field rules: `name` 1–80, `description`
≤ 300, `scopes` at least one entry (**defaults to `["read"]`**), `expiresInDays`
1–3650, `projectId` optional binding. An unknown scope is refused with
`400 UNKNOWN_SCOPE` naming the offender.

- `GET /api/auth/tokens` lists your active tokens (never the secret).
- `DELETE /api/auth/tokens/:id` revokes one (`204`, immediate).
- An API token **cannot create tokens** — the request is refused with `400`.

### Service tokens

`POST /api/admin/service-tokens` (admin, session JWT only) issues a token backed by a
service account that cannot log in and never appears in the directory. See
[API v1 — pipeline integration](v1-integration.md#issuing-a-service-token).

### Scopes

Scopes are `domain:action` over twelve domains — `projects`, `sequences`, `shots`,
`assets`, `tasks`, `versions`, `media`, `comments`, `playlists`, `events`, `webhooks`,
`users` — each with `:read` and `:write`, plus `admin`. Granting `x:write` implies
`x:read`.

```bash
curl -s -H "Authorization: Bearer $JWT" "$REVIEW/api/auth/scopes"
```

```json
{ "scopes": ["projects:read", "projects:write", "…", "admin"], "legacy": ["read", "write"] }
```

Legacy tokens carrying `read`/`write` keep working and are expanded on the fly, but
legacy `write` does **not** grant `webhooks:*` or `users:*`.

A scope never grants more than its bearer already has — role and project membership are
still enforced.

### An API token opens `/api/v1`, and nothing else

Scopes and project binding are enforced by the v1 routes. The web API `/api` is not
annotated per domain and cannot enforce either, so a token is refused there outright:

```bash
curl -s -H "Authorization: Bearer rvk_…" "$REVIEW/api/projects"
# 403 { "error": "API tokens only open the /api/v1 integration API …",
#       "code": "API_TOKEN_V1_ONLY" }

curl -s -H "Authorization: Bearer rvk_…" "$REVIEW/api/v1/projects"   # this is the way
```

Without that rule, a token bound to one project would read and write **every** project as
soon as it aimed at `/api` — the binding would be a promise the server does not keep.
Whatever an integration needs exists in v1: identity (`/api/v1/me`), accepted values and
the scope list (`/api/v1/schema`), reading files (`/api/v1/media/:id/url`), the event
journal (`/api/v1/events`). The public documentation endpoints (`/api/docs`,
`/api/openapi.json`) stay reachable with a token — they serve the same bytes to everyone.

Sessions are unaffected: a signed-in human uses `/api` as before, bounded by their role
and their project memberships. The coarse write gate still applies inside v1 — an API
token with no write scope at all gets `403 SCOPE_WRITE_REQUIRED` on any non-`GET` method,
before the route runs.

## Share links (client access)

Supervisors create share links with `POST /api/share`; `DELETE /api/share/:id` revokes
one. Clients then use `/api/client/*`, which is gated by the link token, not a JWT:

```bash
# 1. open the link — consumes a view
curl -s "$REVIEW/api/client/$SHARE_TOKEN"

# 2. if the link is password-protected, exchange the password for a share session
curl -s -X POST "$REVIEW/api/client/$SHARE_TOKEN/unlock" \
  -H "Content-Type: application/json" -d '{ "password": "•••" }'
# → { "shareAuth": "eyJhbGciOi…" }

# 3. every sub-route requires that session
curl -s -H "X-Share-Auth: $SHARE_AUTH" "$REVIEW/api/client/$SHARE_TOKEN/media/128/url"
curl -s -H "X-Share-Auth: $SHARE_AUTH" "$REVIEW/api/client/$SHARE_TOKEN/media/128/comments"
```

Share links are revocable, may expire, are scoped `VIEW` or `COMMENT`, and only ever
expose published and ready media. Both `/api/share` and `/api/client` are limited to
**300 requests / 15 min per IP**. See [Sharing](../user-guide/sharing.md) and
[Secure distribution](../admin-guide/secure-distribution.md).

## Outgoing webhooks

Configured in *Admin → Communications → API & Webhooks*, or directly:

```bash
curl -s -X POST "$REVIEW/api/admin/webhooks" \
  -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" \
  -d '{
        "url": "https://hooks.mystudio.com/review",
        "events": ["media.published", "review.decision", "task.status_changed"]
      }'
```

`201 Created` — the HMAC `secret` is shown **once**:

```json
{
  "webhook": { "id": 2, "url": "https://hooks.mystudio.com/review",
               "events": ["media.published", "review.decision", "task.status_changed"],
               "active": true, "lastStatus": null, "lastError": null,
               "lastDeliveryAt": null, "createdAt": "2026-08-21T10:20:00.000Z" },
  "secret": "b41c…"
}
```

`events` must contain at least one entry from the 18-event catalogue (listed in
[API v1 — events](v1-integration.md#use-case-2--a-bot-that-follows-status-changes)).
A private, loopback or non-HTTP target is refused with `400 BAD_WEBHOOK_URL`.
`POST /api/admin/webhooks/:id/test` sends a probe delivery.

ReView POSTs JSON to your endpoint for the subscribed events:

```
POST <your url>
Content-Type: application/json
User-Agent: ReView-Webhook/1.0
X-ReView-Event: media.published
X-ReView-Timestamp: 1784480000000
X-ReView-Signature: sha256=<hex>

{ "event": "media.published", "timestamp": 1784480000000, "data": { … } }
```

Verify the signature as `HMAC_SHA256(secret, timestamp + "." + rawBody)` — compare in
constant time, against the **raw** body, and reject a timestamp that is too old.

```python
import hmac, hashlib

def valid(secret: str, timestamp: str, raw_body: bytes, header: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode(), (timestamp + ".").encode() + raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, header)
```

Delivery details, all enforced in the worker container:

- **5 attempts** per delivery, exponential backoff starting at 10 s (BullMQ queue
  `webhooks`, concurrency 3);
- a **10 s** request timeout, and redirects are refused rather than followed;
- private, loopback and link-local targets are re-checked at delivery time, after DNS
  resolution — a public name pointing at `127.0.0.1` or `169.254.169.254` is rejected;
- the last outcome is recorded on the webhook (`lastStatus`, `lastError`,
  `lastDeliveryAt`) and visible in the admin.

A non-2xx response counts as a failure and is retried. After the fifth attempt the
delivery is dropped — there is no dead-letter replay, so a firewalled bot should use
the **pull** journal instead: `GET /api/v1/events`.

## Media access log

Every media consultation (internal review or client share) is journaled
(deduplicated per 30 min) and browsable in *Admin → Maintenance → Media access*.

## Related pages

- [API overview](overview.md) — conventions, errors, rate limits
- [API v1 — pipeline integration](v1-integration.md) — scopes, service tokens, events
- [Python client & DCC integrations](python-client.md) — the shipped client
- [Identity & API (admin)](../admin-guide/identity-and-api.md)
- [Account security (user)](../user-guide/account-security.md)
- [Security model](../infrastructure/security.md)
