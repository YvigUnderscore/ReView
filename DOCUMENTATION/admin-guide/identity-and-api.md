# Identity, API & audit

> Updated: 2026-07-19

## SSO (OIDC) — *Admin → Studio → Identité (SSO)*

Single sign-on with any OIDC provider (Google by default, authorization code
flow):

1. Create OAuth credentials at your provider with the redirect URI
   `https://<your app>/api/auth/oidc/callback`.
2. Fill **URL publique de l'app**, **Issuer** (`https://accounts.google.com`),
   **Client ID** and **Client secret** (stored encrypted, write-only — leave the
   field empty to keep the current one), then enable the button.
3. Optional **auto-provisioning**: an unknown (verified) email creates an Artist
   account on first SSO login; otherwise unknown emails are refused.

Notes: the provider must return a **verified email**; accounts with 2FA still go
through their code step after SSO. Testing requires real provider credentials.

## Sessions & offboarding

Every login is a revocable session (see
[Account security](../user-guide/account-security.md)). To cut all access of a
leaving collaborator: *Utilisateurs* → delete or demote the account, and revoke
all its sessions (`DELETE /api/users/:id/sessions` — immediate, ≤ 30 s), plus its
API tokens in *API & Webhooks*.

## API tokens (studio view) — *Admin → Communications → API & Webhooks*

Lists every active personal token (owner, scope, last use). Revoking here is
immediate. Scopes: `read` = GET only; `write` required for any mutation.

## Outgoing webhooks — same section

- Add a URL + subscribed events (`media.published`, `review.decision`,
  `comment.created`). The **HMAC secret is shown once**.
- Deliveries: JSON POST signed `sha256=HMAC(secret, timestamp.body)`
  (`X-ReView-Signature`), 5 attempts with exponential backoff, sent from the
  worker container. Last status/error is visible per webhook; use the **test**
  button to validate an endpoint.
- SSRF guard: private/loopback/internal hosts are rejected at creation *and* at
  delivery time (hostname patterns; DNS re-resolution is intentionally not
  followed — put your receivers on public hostnames).

## Media access log — *Admin → Maintenance → Accès médias*

One line per consultation (per viewer per media, deduplicated over 30 minutes),
covering internal reviews (account) and client shares (link label), with IP and
timestamp. Complements the audit log (creations/revocations/2FA events…) in
*Maintenance → Audit*.

## Related pages

- [API authentication](../api/authentication.md)
- [Secure distribution](secure-distribution.md)
