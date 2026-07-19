# Authentication & API access

> Updated: 2026-07-19

Three ways to authenticate against the REST API:

| Method | Header | For |
|--------|--------|-----|
| **JWT session** | `Authorization: Bearer <jwt>` | The web app (login/refresh) |
| **API token** | `Authorization: Bearer rvk_<40 hex>` | Scripts & integrations |
| **Share session** | `X-Share-Auth: <jwt>` | Public client share pages only |

## JWT sessions (interactive)

- `POST /api/auth/login` `{ email, password }` → `{ token, refreshToken, user }`.
  Every login creates a **revocable session**; its id (`sid`) is embedded in both
  tokens. If the account has 2FA enabled the response is
  `{ requires2fa: true, tmpToken }` instead (see below).
- `POST /api/auth/refresh` `{ refreshToken }` → new token pair. Requires the
  session to still be active (revoked/expired → `401 SESSION_REVOKED`) and slides
  its expiry.
- `POST /api/auth/logout` revokes the current session — both tokens die with it
  (enforced by the auth middleware with a ≤ 30 s cache).
- `GET /api/auth/sessions` lists the account's active sessions (`current: true`
  marks the calling one); `DELETE /api/auth/sessions/:sid` revokes one. Admins can
  revoke everything for a user with `DELETE /api/users/:id/sessions` (offboarding).

## Two-factor authentication (TOTP)

- Enrollment (authenticated): `POST /api/auth/2fa/setup` → `{ secret, otpauth }`
  (render the `otpauth://` URI as a QR); `POST /api/auth/2fa/enable { code }` →
  `{ backupCodes: [...] }` — 10 one-time codes, shown **once**, stored hashed.
- Login with 2FA: `POST /api/auth/login` → `{ requires2fa, tmpToken }` (5 min),
  then `POST /api/auth/2fa/verify { tmpToken, code }` → normal token pair. `code`
  accepts the TOTP or an unused backup code (then consumed). Rate-limited.
- `POST /api/auth/2fa/disable { password }` turns it off.
- The TOTP secret is stored encrypted (AES-GCM); audit events cover
  enable/disable/failed attempts/backup-code use.

## SSO (OIDC)

When configured by an admin (*Admin → Studio → Identité (SSO)*), the login page
shows an SSO button:

- `GET /api/auth/oidc/status` (public) → `{ enabled, label }`.
- `GET /api/auth/oidc/login` redirects to the provider (authorization code flow;
  state + nonce carried in a short-lived signed httpOnly cookie).
- `GET /api/auth/oidc/callback` exchanges the code, requires a **verified email**,
  matches the account by email (optional auto-provisioning as Artist), honours
  2FA (redirects into the same code step), and hands tokens to the SPA via the
  URL **fragment** (never sent to any server).

## Personal API tokens

Created from the profile page (or listed studio-wide in *Admin → API & Webhooks*):

- `POST /api/auth/tokens { name, scopes, expiresInDays? }` → `{ token, apiToken }`.
  The plaintext `rvk_…` value is returned **once**; only its sha256 hash is stored.
- Scopes: `read` (GET/HEAD only) or `read` + `write`. Write requests without the
  `write` scope get `403 SCOPE_WRITE_REQUIRED`.
- API tokens cannot create other tokens, and revocation
  (`DELETE /api/auth/tokens/:id`, or by an admin) is immediate.

Example:

```bash
curl -H "Authorization: Bearer rvk_…" https://review.studio.com/api/projects
```

## Outgoing webhooks

Configured in *Admin → Communications → API & Webhooks*. ReView POSTs JSON to your
endpoint for the subscribed events (`media.published`, `review.decision`,
`comment.created`) with 5 retries (exponential backoff):

```
POST <your url>
X-ReView-Event: media.published
X-ReView-Timestamp: 1784480000000
X-ReView-Signature: sha256=<hex>
{ "event": "media.published", "timestamp": 1784480000000, "data": { … } }
```

Verify the signature: `HMAC_SHA256(secret, timestamp + "." + rawBody)` and compare
to the header (constant-time). The secret is shown once at creation. Private/local
hosts are rejected (SSRF guard) — deliveries leave from the worker container.

## Media access log

Every media consultation (internal review or client share) is journaled
(deduplicated per 30 min) and browsable in *Admin → Maintenance → Accès médias*.
