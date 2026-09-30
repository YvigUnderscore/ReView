# Account security

*Two-factor sign-in, the devices holding a session, and personal tokens scoped to exactly what a script needs.*

> Updated: 2026-08-23

Three cards sit at the bottom of your profile page (`/profile`), in this order:
**Two-factor authentication (2FA)**, **Active sessions**, **API tokens**. They answer three
different questions — *who can sign in as me*, *who is signed in as me right now*, and *what
runs on my behalf without me*. The cards above them — avatar, identity, password, display,
notifications — are covered in [Personalization](personalization.md).

One rule cuts across all three, and it is the one people discover the hard way: **changing
your password or your login email revokes every other session and every personal API token you
own**. The session you are using survives, so you are not thrown out of the page you are on.
That is deliberate — taking your account back has to actually take it back, and a token a
thief created for themselves would otherwise outlive the password change indefinitely.

## Two-factor authentication (2FA)

Under **Two-factor authentication (2FA)**:

1. Click **Enable 2FA**. ReView generates a secret and shows a QR code.
2. Scan it with any TOTP app (Google Authenticator, 1Password, Authy…) or type the **manual
   entry** value, then confirm with the 6-digit code the app displays. Nothing is enforced
   until that code is accepted — an enrolment left half-finished changes nothing.
3. **Write down the ten backup codes** that appear at that moment. They are shown once and
   never again: the server keeps only their hashes.

![Off, Enrolling and On, with the gesture that moves between them; the confirmation step also hands over ten backup codes shown once, and disabling asks for your password and wipes the secret with every remaining code. Below, signing in while it is on: a correct password opens a short-lived challenge that a TOTP code or a single-use backup code turns into a session.](../assets/user-guide/two-factor-states.svg)

From then on, signing in stops at the code step. **SSO logins are covered too**: coming back
from the identity provider lands on the same challenge, so 2FA is not bypassed by a second
door.

| Detail | Value |
|--------|-------|
| Backup codes | **10**, hexadecimal, in four groups of eight for copying by hand |
| Backup code reuse | None — each one is consumed the first time it works |
| TOTP code reuse | None — a code already presented is refused exactly like a wrong one |
| Challenge lifetime | **5 minutes**; past that, `TWOFA_TOKEN_EXPIRED` and you start the sign-in again |
| Rate limit | **15 verification attempts per 15 minutes** |
| Audit entries | `TWOFA_ENABLE`, `TWOFA_DISABLE`, `TWOFA_FAIL`, `TWOFA_BACKUP_USED` |

Disabling asks for your **password**, not a code: someone sitting at an unlocked session
cannot quietly turn the protection off. Disabling also **wipes the secret and whatever backup
codes were left**, which is why enabling it again always produces a fresh set of ten and
retires the old ones for good.

> [!CAUTION]
> A `TWOFA_BACKUP_USED` entry nobody can explain deserves a conversation the same day: it
> means someone signed in as that account without the phone. The audit log is in
> [Identity, API & audit](../admin-guide/identity-and-api.md).

**Use cases.**

- *Lost phone, backup codes at hand.* Sign in with a backup code, disable 2FA with your
  password, enable it again on the new phone. That regenerates ten codes and invalidates the
  old ones.
- *Lost phone, no backup code left.* Only an administrator can help, from the account's page
  in Administration. This is the reason to keep the codes somewhere other than the phone.
- *Rolling 2FA out to the studio.* Ask people to enable it themselves; the administration user
  list shows who has, so you can chase the rest without asking anyone.

## Active sessions

**Active sessions** lists every device holding a live session: a readable label derived from
the browser and operating system (Chrome on Windows, Safari on iOS…), the IP address, when the
session started and when it was last active, most recent first. The one you are using carries
a **This device** badge.

- Revoking a session invalidates both of its tokens. The check is cached for **30 seconds**,
  so a revoked session stops working within that window at the latest.
- Revoking **This device** signs you out here and now — it is the same gesture as logging out.
- Logging out revokes the session server-side. Closing the tab does **not**: the session stays
  listed until it expires.
- Expired sessions drop off the list on their own; sessions created before this feature
  existed never appear, and signing in again registers one.

> [!TIP]
> You reviewed dailies from a workstation in a screening room and cannot get back to it. Open
> your profile, find the session whose device or IP you recognise, revoke it. Nothing else
> about your account changes — no password reset, no lost 2FA enrolment.

Administrators have a wider version of the same list: **Administration → Users →** the
account → **Active sessions**, with a **Revoke all** button. That is the offboarding gesture,
and it is also what disabling an account, changing its role or resetting its password does on
its own.

## Personal API tokens

**API tokens** issues tokens for your own scripts and integrations. A token acts **as you**,
with your role and your project memberships — it can never reach further than you can.

![The creation form: a grid of one row per domain with a read box and a write box, projects and events being read-only, plus the exclusive admin scope; alongside it the name, the optional project the token can never leave, the expiry and the current password the server demands. The secret is shown once and opens the v1 integration API only.](../assets/user-guide/token-scope-matrix.svg)

Click **New token**. The form asks for five things:

| Field | Values | Default |
|-------|--------|---------|
| **Name** | Free text, up to 80 characters — `ingest script`, `render farm publish` | — |
| **Project** | *All projects*, or one the token can never leave | *All projects* |
| **Expiry** | 30, 90, 365 days, or *Never* | **365 days** |
| **Scopes** | One row per domain, a **read** box and a **write** box, plus `admin` | None — at least one is required |
| **Current password** | Your account password | — |

That last field is not decoration. A `rvk_…` can be set never to expire and survives the tab
being closed, so a token forged from a stolen access token turns a passing session theft into
lasting access — the kind that *sign out everywhere* does not even suspect. Your password is
the one thing the thief does not have. Without it the server answers
`401 CURRENT_PASSWORD_REQUIRED`, and the **Create** button stays disabled until the field is
filled.

The `rvk_…` value is displayed **once**, with a copy button. The server stores only its
SHA-256 hash, so it cannot be shown again — a lost token is replaced, never recovered.

Each row of the list then carries what you need to audit it later: its name, a badge saying
*Read*, *Read + write* or *Full access*, the creation date, the **last used** date (or *never
used*), the expiry, and the literal scope string as you would write it in a script. Last use
is refreshed at most once a minute per token, so a busy script does not hammer the database.

> [!IMPORTANT]
> There is no *Revoke* button on a token row. **Right-click the row** and choose *Revoke* —
> the same convention as everywhere else in ReView. The effect is immediate: the next request
> carrying that token is refused.

## What a token may do, and where

Scopes are `domain:action` pairs, and the grid is built from the catalogue the server serves
at `GET /api/auth/scopes`. That matters: the day a scope stops guarding anything it stops
being offered, without anyone editing a screen. Three rules keep the boxes honest, and they
are exactly what the server does anyway:

- ticking **write** ticks **read** of the same domain — an integration that writes has to read
  back what it wrote;
- unticking **read** unticks **write**, because a ticked write box would otherwise be a lie;
- ticking **admin** clears everything else: it covers every domain, and nothing sits beside it.

Two domains are read-only because nothing else is exposed: `projects` (creating a show is not
the integration API's job) and `events` (the journal writes itself). Older tokens carrying the
coarse `read` or `write` scope keep working and are expanded on the fly.

> [!WARNING]
> An API token opens **`/api/v1`, and nothing else**. Aiming a `rvk_…` at the web API `/api`
> is refused with `403 API_TOKEN_V1_ONLY`, even for a read. The web API is not annotated per
> domain, so it can enforce neither scopes nor the project binding — a token confined to one
> show would have read every other one the moment it hit `/api/projects`. Everything an
> integration needs exists in v1.

```bash
curl -H "Authorization: Bearer rvk_…" https://review.example.com/api/v1/projects
```

The refusals a script can meet, and what each one means:

| Status | `code` | What happened |
|--------|--------|---------------|
| 403 | `API_TOKEN_V1_ONLY` | The request aimed at `/api` instead of `/api/v1` |
| 403 | `API_TOKEN_INVALID` | Unknown, revoked, or past its expiry |
| 403 | `SCOPE_WRITE_REQUIRED` | A non-`GET` request from a token carrying no write scope at all |
| 403 | `SCOPE_REQUIRED` | The route wanted a scope the token does not have; the message names it |
| 403 | `TOKEN_PROJECT_SCOPE` | The token is bound to a project and the request touched another |
| 400 | — | The token tried to create another token: no self-escalation, ever |

Field rules and full request examples are in
[API authentication](../api/authentication.md#api-tokens).

## Use cases

### A render farm that publishes playblasts

Create a token confined to the show, ticking **write** on `versions` and `media` (read follows
on its own), with an expiry that matches the delivery date. It cannot touch another project
even if the wrong path is typed, and it expires without anyone having to remember it. See
[API v1 — pipeline integration](../api/v1-integration.md).

### A dashboard that only reads

Tick **read** on the domains it displays and nothing else. Leaked from a configuration file,
that token still cannot change a status, a comment or a media.

### A robot account shared by the team

Do not use a personal token: it dies with your password change, and it disappears the day you
leave. A service token belongs to a **service account** that cannot sign in and never appears
in the directory. Administrators issue those under **Administration → Communications →
Service tokens**.

### Handing a workstation back

Revoke its session from **Active sessions**, and revoke any token you created for it by
right-clicking the row. If you would rather not enumerate them, change your password: it
revokes every other session and every one of your tokens in one gesture.

## Related pages

- [Personalization](personalization.md) — display, identity and notification preferences
- [Users & roles (admin)](../admin-guide/users-and-roles.md)
- [Identity, API & audit (admin)](../admin-guide/identity-and-api.md) — SSO, audit log
- [API authentication](../api/authentication.md) — the request-level contract
- [API v1 — pipeline integration](../api/v1-integration.md) — what a token can call
