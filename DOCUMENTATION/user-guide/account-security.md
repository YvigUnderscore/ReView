# Account security

> Updated: 2026-07-19

Everything below lives on your **profile page**.

## Two-factor authentication (2FA)

1. *Two-step verification (2FA)* → **Activer la 2FA**.
2. Scan the QR code with any TOTP app (Google Authenticator, 1Password, Authy…)
   or type the secret manually, then confirm with the 6-digit code.
3. **Save the 10 backup codes** shown once — each works a single time if you lose
   your device.

From then on, logging in asks for a code after your password (SSO logins too).
Disable it anytime with your password.

## Active sessions

The *Sessions actives* section lists every device connected to your account
(browser/OS, IP, first and last activity). The current one is tagged
**Cet appareil**.

- Revoking a session immediately invalidates its tokens (≤ 30 s) — use it if you
  left yourself logged in somewhere.
- Logging out revokes the current session server-side.
- Admins can revoke **all** sessions of an account when offboarding someone.

## API tokens

The *Tokens d'API* section creates personal tokens for scripts and integrations:

- Choose a name and a scope — **Read** (read-only) or **Read + write**.
- The `rvk_…` value is displayed **once**: copy it right away.
- Use it as `Authorization: Bearer rvk_…`; revoke it whenever, effect is
  immediate. Details: [API authentication](../api/authentication.md).

## Related pages

- [Users & roles (admin)](../admin-guide/users-and-roles.md)
- [Identity, API & audit (admin)](../admin-guide/identity-and-api.md)
