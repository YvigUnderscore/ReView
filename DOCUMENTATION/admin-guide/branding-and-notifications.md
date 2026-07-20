# Studio branding & team notifications

Administrator settings under **Admin → Settings**.

## Studio theme

- **Accent color** — pick a color used as the interface primary (buttons, links, focus rings).
  It applies across the app **and the sign-in page**, and takes effect after a reload. Use
  *Reset* to return to the default cyan.
- **Studio logo** — the logo uploaded for burn-ins and the client portal is also shown on the
  sign-in screen.

The public branding (name, accent, logo) is served without authentication so it can style the
login page.

## Team chat notifications (Slack / Discord)

ReView can post short messages to a team channel on key events (**review decisions** and
**published media**).

- **Discord** — set the studio Discord webhook URL (`https://discord.com/api/webhooks/…`).
- **Slack** — set **Slack webhook (notifications)** to an incoming webhook
  (`https://hooks.slack.com/services/…`).

Both URLs are validated against a strict host allowlist (anti-SSRF): only official Discord and
Slack webhook hosts over HTTPS are accepted; anything else is ignored and never contacted.

## Browser push (Web Push)

Push notifications work out of the box: if `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` are not set in
the environment, a VAPID key pair is generated and stored on first use. For production, set the
environment variables (and optionally `VAPID_SUBJECT`) so keys stay stable across deployments.
Users opt in from **Profile → Notifications**.
