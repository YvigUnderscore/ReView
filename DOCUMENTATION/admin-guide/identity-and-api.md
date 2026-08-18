# Identity, API & audit

> Updated: 2026-08-10

## SSO (OIDC) — *Admin → Studio → Identity (SSO)*

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

### SSO button logo

Upload a PNG, JPEG or WebP in *Logo du bouton SSO*: it is shown to the left of
the button label on the login page (SVG is refused — these files are served from
the app's own origin). *Remove* falls back to a plain text button.

### SSO only — turning off password login

*Couper la connexion par mot de passe (SSO seul)* removes the email + password
form from the login page and makes `POST /api/auth/login` (and self-registration)
answer `403 PASSWORD_LOGIN_DISABLED`. Everyone then signs in through the
provider; 2FA, personal API tokens and service tokens are unaffected.

Two guards stand between this switch and a locked-out studio:

- the setting **cannot be saved** while the SSO config is incomplete (the server
  rejects it with `SSO_NOT_READY`);
- if the SSO config is later emptied or disabled, **password login comes back on
  its own** — the block only applies while SSO can actually take over.

That covers a broken *configuration*, not a broken *provider*: if the identity
provider itself becomes unreachable while the config stays valid, nobody can sign
in. Keep a way back in: a personal API token owned by an admin account, issued
*before* the switch, still authenticates and can `PUT /api/admin/oidc` to clear
the flag — otherwise it takes a hand edit of the `oidc_config` setting in the
database.

## Sessions & offboarding

Every login is a revocable session (see
[Account security](../user-guide/account-security.md)). To cut all access of a
leaving collaborator: *Utilisateurs* → delete or demote the account, and revoke
all its sessions (`DELETE /api/users/:id/sessions` — immediate, ≤ 30 s), plus its
API tokens in *API & Webhooks*.

## API tokens (studio view) — *Admin → Communications → API & Webhooks*

Lists every active personal token (owner, scope, last use). Revoking here is
immediate.

**Scopes** are fine-grained: `domain:action` over `projects`, `sequences`, `shots`,
`assets`, `tasks`, `versions`, `media`, `comments`, `playlists`, `events`,
`webhooks`, `users` — plus `admin`. Tokens issued before this keep their `read` /
`write` scope and are expanded on the fly, except for `webhooks:*` and `users:*`,
which a legacy `write` never grants. `GET /api/auth/scopes` returns the catalogue.

A token can be **bound to one project**: it then cannot reach any other, even if its
owner could.

## Service tokens — machine identities

`POST /api/admin/service-tokens` (admin only) issues a token for a render farm, a
pipeline daemon or a bot. It is backed by a service account that **cannot log in**
and never appears in the directory, mail digests or presence lists — it exists so
that writes keep an author and an audit trail. Choose its role (`SUPERVISOR`,
`ARTIST` or `CLIENT`; never admin) and, ideally, bind it to a project.

Revoking a service token leaves its account in place: past work keeps its author.

See [API v1 — pipeline integration](../api/v1-integration.md).

## Outgoing webhooks — same section

- Add a URL + subscribed events. The catalogue now covers the pipeline life cycle
  (`version.published`, `task.status_changed`, `shot.created`…) beside the original
  `media.published`, `review.decision` and `comment.created`; existing webhooks are
  unaffected. `GET /api/v1/schema` lists them all. The **HMAC secret is shown once**.
- A receiver that cannot be reached from outside the studio can instead **poll**
  `/api/v1/events` — same catalogue, cursor-based.
- Deliveries: JSON POST signed `sha256=HMAC(secret, timestamp.body)`
  (`X-ReView-Signature`), 5 attempts with exponential backoff, sent from the
  worker container. Last status/error is visible per webhook; use the **test**
  button to validate an endpoint.
- SSRF guard: private/loopback/internal hosts are rejected at creation *and* at
  delivery time (hostname patterns; DNS re-resolution is intentionally not
  followed — put your receivers on public hostnames).

## Media access log — *Admin → Maintenance → Media access*

One line per consultation (per viewer per media, deduplicated over 30 minutes),
covering internal reviews (account) and client shares (link label), with IP and
timestamp. Complements the audit log (creations/revocations/2FA events…) in
*Maintenance → Audit*.

## Related pages

- [API authentication](../api/authentication.md)
- [API v1 — pipeline integration](../api/v1-integration.md)
- [Secure distribution](secure-distribution.md)
