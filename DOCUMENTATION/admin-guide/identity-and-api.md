# Identity, API & audit

> Updated: 2026-08-21

## SSO (OIDC) — *Admin → Studio → Identity (SSO)*

Single sign-on with any OIDC provider, authorization code flow with state and nonce.

1. Create OAuth credentials at your provider with the redirect URI
   `https://<your app>/api/auth/oidc/callback`.
2. Fill **App public URL**, **Issuer**, **Client ID** and **Client secret**, then
   enable the button.
3. Optionally enable **auto-provisioning**.

| Field | Default | Notes |
|-------|---------|-------|
| `enabled` | `false` | |
| `issuer` | `https://accounts.google.com` | Pre-filled; leave it if you use Google |
| `clientId` | empty | |
| `clientSecret` | empty | **Write-only**: stored AES-256-GCM encrypted, never returned. The API exposes only `hasSecret`. Submitting an empty value keeps the current secret. |
| `publicUrl` | empty | Trailing slash stripped; it is what the redirect URI is built from |
| `autoProvision` | `false` | An unknown but **verified** email creates an **`ARTIST`** account on first SSO login; otherwise unknown emails are refused |
| `buttonLabel` | "Sign in with Google" | |
| `passwordLoginDisabled` | `false` | See below |

Notes: the provider must return a **verified email**; accounts with 2FA still go
through their code step after SSO. Auto-provisioned logins are audited as
`OIDC_PROVISION`, successful ones as `OIDC_LOGIN`. Callback failures redirect to
`/login#ssoerr=<message>` rather than returning JSON.

### SSO button logo

Upload a PNG, JPEG or WebP (`POST /api/admin/oidc/logo/presign`, `ADMIN`, 15-minute
presigned PUT to `branding/sso-{timestamp}.{ext}`). It is shown to the left of the
button label on the login page. **SVG is refused** — these files are served from the
app's own origin and an SVG is a scriptable document. *Remove* falls back to a plain
text button.

### SSO only — turning off password login

*Disable password sign-in (SSO only)* removes the email + password form from the
login page and makes `POST /api/auth/login` and self-registration answer
**`403 PASSWORD_LOGIN_DISABLED`**. Everyone then signs in through the provider; 2FA,
personal API tokens and service tokens are unaffected.

Three guards stand between this switch and a locked-out studio:

- the setting **cannot be saved** while the SSO configuration is incomplete — the
  server rejects it with **`400 SSO_NOT_READY`**. "Complete" means `enabled`,
  `clientId`, `clientSecret` and `publicUrl` are all set (the issuer is not checked;
  it always has a default);
- any *other* save made while the configuration is incomplete silently coerces the
  flag back to `false`;
- **the block is re-evaluated on every single login attempt**, not just when the
  configuration is written. The instant the SSO configuration stops being complete —
  a cleared secret, a disabled toggle — password login is back, with no administrative
  action at all.

That covers a broken *configuration*, not a broken *provider*: if the identity
provider itself becomes unreachable while the configuration stays valid, nobody can
sign in. Keep a way back in:

> **Break-glass token.** A personal API token owned by an admin account still
> authenticates and can call `PUT /api/admin/oidc` to clear the flag. It only works if
> the token was issued with a **write-granting scope** (`write`, `admin`, or any
> `*:write`) — API tokens are refused on every non-`GET` request otherwise, with
> `403 SCOPE_WRITE_REQUIRED`, and the default scope on a new token is `read`. Issue
> this token **before** flipping the switch. Without it, recovery means editing the
> `oidc_config` row in the database by hand.

Because that path exists, an admin-owned write-scoped token can reach **every**
`/api/admin/*` route. Treat such a token as an administrator credential and prefer a
project-bound, read-scoped token everywhere else. The one exception is
`/api/admin/service-tokens`, which refuses API-token callers outright.

Note also that in SSO-only mode the password + 2FA path is unreachable in practice:
the intermediate 2FA token is only minted by `POST /api/auth/login`, which is blocked.
Only the SSO → 2FA path works.

## Sessions & offboarding

Every login creates a revocable session (see
[Account security](../user-guide/account-security.md)).

| Action | Route | Role |
|--------|-------|------|
| List own sessions | `GET /api/auth/sessions` | any account |
| Revoke one own session | `DELETE /api/auth/sessions/:sid` | owner |
| Revoke one session of any account | `DELETE /api/admin/sessions/:sid` | `ADMIN` |
| Revoke **all** sessions of an account | `DELETE /api/users/:id/sessions` | `ADMIN` |

Revocation is effective in **≤ 30 s** (in-process cache), immediately in the process
that performed it.

To cut all access of a leaving collaborator, the reliable shortcut is to **change
their role** in *Users*: the role change revokes every session **and** every API token
of the account in one move. `DELETE /api/users/:id/sessions` revokes **sessions
only** — their API tokens survive and must be revoked separately in *API & Webhooks*.
Deleting the account additionally revokes every share link they created. See
[Users & roles](users-and-roles.md#use-case-removing-a-contractor-at-the-end-of-a-contract).

## API tokens (studio view) — *Admin → Communications → API & Webhooks*

`GET /api/admin/api-tokens` lists every **active** token of the studio — personal
**and** service tokens — with owner, scopes, last use and expiry.
`DELETE /api/admin/api-tokens/:id` revokes immediately (no cache; every request
re-reads the token) and is audited as `API_TOKEN_REVOKE`.

Users create their own tokens with `POST /api/auth/tokens`; the clear value
(`rvk_` + 40 hex characters) is **shown once** and stored only as a SHA-256 hash. A
token cannot create another token.

**Scopes** are `domain:action` over 12 domains — `projects`, `sequences`, `shots`,
`assets`, `tasks`, `versions`, `media`, `comments`, `playlists`, `events`, `webhooks`,
`users` — plus `admin`, which grants everything. `GET /api/auth/scopes` returns the
catalogue (authentication required).

- Legacy tokens keep their `read` / `write` scope and are expanded on the fly, **except
  for `webhooks:*` and `users:*`, which neither legacy `read` nor legacy `write` ever
  grants**. Those four must be granted explicitly.
- Granting `d:write` implies `d:read`.
- A separate, coarser guard sits in front of everything: an API token is refused on
  any non-`GET`/`HEAD`/`OPTIONS` request unless it carries `write`, `admin` or some
  `*:write` (`403 SCOPE_WRITE_REQUIRED`). This applies to the whole internal `/api`
  surface, which is not domain-annotated.
- The `webhooks:*` and `users:*` scopes are currently **enforced nowhere** — webhook
  administration is gated by the `ADMIN` role alone. Granting them changes nothing
  today; do not rely on them as a control.

A token can be **bound to one project**. Cross-project access is then refused with
`403 TOKEN_PROJECT_SCOPE` — **on the `/api/v1` surface**. The binding is a
handler-level check used by the v1 pipeline routes; the internal `/api` routes do not
apply it. A project-bound token is a pipeline safety belt, not a containment boundary
for a token that can also call `/api`.

Tokens have **no expiry by default** (`expiresInDays` is optional, maximum 3650). An
issued token lives until it is revoked. Set an expiry on anything handed to a
contractor.

## Service tokens — machine identities

`POST /api/admin/service-tokens` (**`ADMIN` only**) issues a token for a render farm, a
pipeline daemon or a bot. It is backed by a service account that:

- **cannot log in** — the login route refuses service accounts with the same message
  as a wrong password, so probing tells an attacker nothing;
- never appears in the directory, presence lists, mail digests, weekly reports, chat,
  assignment pickers or invitations;
- exists so that writes keep an author and an audit trail.

Choose its role: `SUPERVISOR`, `ARTIST` or `CLIENT`, defaulting to `ARTIST`. **`ADMIN`
is not an accepted value** — a machine identity is never an administrator. Binding the
token to a project also **creates the project membership** for the service account,
which an `ARTIST`-role service account needs in order to see the project at all.

Revoking a service token leaves its account in place: past work keeps its author.
Reusing the same service name reuses the account.

This router is the only `/api/admin/*` one that **refuses API-token callers**: service
tokens cannot mint service tokens. There is no UI for it — it is API-only.

See [API v1 — pipeline integration](../api/v1-integration.md).

## Outgoing webhooks — same section

All routes are `ADMIN` (`/api/admin/webhooks`), audited as `WEBHOOK_CREATE`,
`WEBHOOK_UPDATE`, `WEBHOOK_DELETE`.

- Add a URL and subscribe to events. The **HMAC secret is shown once** at creation and
  stored encrypted.
- **Deliveries**: JSON `POST` signed
  `sha256=HMAC(secret, "<timestamp>.<body>")` in the `X-ReView-Signature` header,
  alongside `X-ReView-Event` and `X-ReView-Timestamp`. 10-second timeout, redirects
  are never followed, **5 attempts with exponential backoff** starting at 10 s, sent
  from the **worker** container. The last status and error are visible per webhook;
  the **test** button enqueues a real signed delivery with the event name `test`.
- A receiver that cannot be reached from outside the studio can instead **poll**
  `GET /api/v1/events` (scope `events:read`, cursor-based, 1–500 per page, default
  100). Called without a `since` cursor it deliberately returns an empty page and the
  current cursor rather than replaying history — take the cursor, then poll from it.
- `GET /api/v1/schema` returns the full scope and event catalogues.

**SSRF protection works in two stages, and they are not the same check:**

- **At creation**, the URL is matched against hostname patterns: non-HTTP schemes,
  `localhost`, `127.*`, `10.*`, `192.168.*`, `172.16–31.*`, `169.254.*`, `0.0.0.0`,
  `::1`, anything ending in `.local`/`.internal`/`.lan`, and dotless hostnames are
  refused with `400 BAD_WEBHOOK_URL`. No DNS is involved.
- **At delivery**, the hostname **is resolved** and the delivery is refused if any
  returned address is private — RFC1918, loopback, link-local, CGNAT, multicast, and
  the IPv6 equivalents including `::ffff:` mapped addresses and NAT64. So a public
  hostname that resolves to an internal IP is blocked at send time, and the refusal is
  recorded on the webhook.

The residual gap is DNS **rebinding** between the lookup and the request — unavoidable
without driving the socket directly, and mitigated by refusing redirects.

### Which events actually fire

The catalogue has 18 event names, but **only ten are emitted today**:

`comment.created`, `comment.resolved`, `media.published`, `review.decision`,
`task.created`, `task.updated`, `task.status_changed`, `task.assigned`,
`version.created`, `version.published`.

The other eight — `project.created`, `project.updated`, `sequence.created`,
`shot.created`, `shot.updated`, `asset.created`, `media.uploaded`, `media.failed` —
are declared and subscribable but have no emitter. Subscribing to them succeeds and
delivers nothing. Do not build a pipeline that waits on `shot.created`.

Separately, the **admin UI only offers three** of them (`media.published`,
`review.decision`, `comment.created`). The pipeline events are reachable only through
a direct `POST /api/admin/webhooks`.

## Media access log — *Admin → Maintenance → Media access*

`GET /api/admin/media-access` (`ADMIN`, paginated, newest first): one line per
consultation, **deduplicated per viewer per media over 30 minutes**, covering internal
reviews (the account) and client shares (the link label, the IP and the timestamp). A
link that has since been purged shows a placeholder label rather than dropping the
row.

Logging is fire-and-forget: a failure is logged and never blocks the request, so the
log is evidence, not proof of completeness.

It complements the audit log (creations, revocations, 2FA events, configuration
changes) in *Maintenance → Audit* — see
[System & maintenance](system-and-maintenance.md#audit--admin--maintenance--audit).

---

## Use case: giving the render farm write access to one show

*The farm must publish playblasts into one project, and nothing else.*

1. `POST /api/admin/service-tokens` (`ADMIN`; there is no UI) with a descriptive name,
   role **`ARTIST`**, and `projectId` set to the show. The membership is created for
   you.
2. Store the returned token in the farm's secret store. It is shown **once**.
3. Have the farm use the **`/api/v1`** endpoints. That is where the project binding is
   enforced (`403 TOKEN_PROJECT_SCOPE`); the internal `/api` routes do not apply it.
4. Do not choose `SUPERVISOR` "to avoid permission problems" — a supervisor-role
   service account sees and writes to every project in the studio, binding or not.
5. When the show wraps, revoke the token. The service account stays, so every version
   it published keeps its author.

## Use case: rotating out a compromised token

*A token was pasted into a public CI log.*

1. Revoke it now: *Admin → API & Webhooks*, or `DELETE /api/admin/api-tokens/:id`.
   Revocation is checked on every request with no cache, so it is instant.
2. Work out what it could do. A token with `write` or `admin` owned by an admin
   account could reach every `/api/admin/*` route. If so, treat this as an
   administrator credential compromise, not a token leak.
3. Check *Maintenance → Audit* for what it did — `SHARE_CREATE`, `USER_*`,
   `SETTING_UPDATE`, `WEBHOOK_CREATE` around the exposure window.
4. Reissue with the narrowest scope that works, an expiry, and a project binding.
5. Remember that changing the owner's password or email **also** revokes all of their
   API tokens — convenient if you want a clean slate, disruptive if the owner runs
   other automations.

## Use case: turning on SSO without locking yourself out

1. Configure the provider and enable the SSO **button** first. Leave password login
   on. Sign in through the provider with a **test account** and confirm the email
   comes back verified.
2. Decide about auto-provisioning. On, any verified email your provider accepts gets
   an `ARTIST` account on first login — appropriate for a studio-owned directory,
   dangerous for a tenant that accepts external identities.
3. Issue a break-glass personal API token on an admin account, **with a write scope**,
   and store it outside the app.
4. Only then enable *SSO only*. If the configuration is incomplete the save is
   refused with `400 SSO_NOT_READY`.
5. Verify the recovery path once, in a test window: clear the SSO client secret and
   confirm password login comes back on the very next attempt.

## Related pages

- [API authentication](../api/authentication.md)
- [API v1 — pipeline integration](../api/v1-integration.md)
- [Users & roles](users-and-roles.md)
- [Secure distribution](secure-distribution.md)
- [System & maintenance](system-and-maintenance.md)
