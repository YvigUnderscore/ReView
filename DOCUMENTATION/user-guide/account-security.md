# Account security

> Updated: 2026-08-21

Everything below lives on your **profile page** (`/profile`).

## Two-factor authentication (2FA)

Under **Two-step verification**:

1. Click **Enable 2FA**. ReView generates a secret and shows a QR code.
2. Scan it with any TOTP app (Google Authenticator, 1Password, Authy…) or use the
   **Manual entry** value, then confirm with the 6-digit code the app displays.
3. **Write down the 10 backup codes** shown at that moment. They are shown once and never
   again — the server only keeps their hashes.

From then on, logging in asks for a code after your password. **SSO logins are covered
too**: signing in through the identity provider still stops at the code step, so 2FA is not
bypassed by a second door.

Each backup code works exactly once and is consumed on use. Losing your phone with no
backup code left means an administrator has to intervene.

Disabling 2FA requires your **password**, not a code — someone holding an unlocked session
cannot quietly turn the protection off.

Verification is rate-limited to 15 attempts per 15 minutes, and every step is written to
the audit log: enabling, disabling, a failed code, and the use of a backup code. A
`TWOFA_BACKUP_USED` entry that nobody can explain is worth a conversation.

**Use cases.**

- *Lost phone, backup codes at hand.* Sign in with a backup code, disable 2FA with your
  password, then enable it again on the new device — that regenerates a fresh set of ten
  codes and invalidates the old ones.
- *Lost phone, no backup code.* Only an administrator can help, from the user's
  administration page. Treat this as the reason to store the codes somewhere other than the
  phone.
- *Rolling out 2FA to the studio.* Ask people to enable it themselves; the administration
  user list shows who has, so you can chase the rest without asking.

## Active sessions

**Active sessions** lists every device connected to your account: a readable device label
derived from the browser and OS (Chrome on Windows, Safari on iOS…), the IP address, when
the session was created and when it was last active, most recent first. The one you are
using is tagged **This device**.

- Revoking a session immediately invalidates its tokens. The check is cached for 30
  seconds, so a revoked session stops working within that window at the latest.
- Logging out revokes the current session server-side — closing the tab does not.
- Sessions that expire drop off the list on their own.
- Administrators can revoke **all** sessions of an account from the API & Webhooks section,
  which is the gesture to use when offboarding someone.

Sessions created before this feature existed do not appear; signing in again registers one.

**Use case.** You reviewed dailies from a workstation in a screening room and cannot get
back to it. Open the profile, find the session whose IP or device you recognise, revoke it.
Nothing else about your account changes.

## API tokens

**API tokens** creates personal tokens for scripts and integrations.

- Give it a name (`ingest script`, `render farm publish`) and a scope: **Read**
  (`GET` only) or **Read + write**.
- The `rvk_…` value is displayed **once**: copy it right away. The server stores only its
  SHA-256 hash, so it cannot be shown again.
- Use it as `Authorization: Bearer rvk_…`.
- Revoke it whenever; the effect is immediate.

A token acts **as you**, with your role. It cannot escalate: an API token is refused when
it tries to create another token.

```bash
curl -H "Authorization: Bearer rvk_…" https://review.example.com/api/projects
```

The REST API accepts more than the profile screen exposes — fine-grained scopes, an
expiry in days, and confinement to a single project. Use those when the token lives on a
machine you do not control. Details: [API authentication](../api/authentication.md).

**Use cases.**

- *A render farm that publishes playblasts.* Create a **Read + write** token confined to
  the project, with an expiry matching the show. See
  [API v1 — pipeline integration](../api/v1-integration.md).
- *A dashboard that only reads.* A **Read** token cannot change anything even if it leaks
  from a config file.
- *A shared robot account.* Do not use a personal token: a service token belongs to a
  service account, so it survives the person leaving. Administrators create those under
  **Administration → API & Webhooks**.

## Related pages

- [Personalization](personalization.md) — notification and email preferences
- [Users & roles (admin)](../admin-guide/users-and-roles.md)
- [Identity, API & audit (admin)](../admin-guide/identity-and-api.md)
- [API authentication](../api/authentication.md)
