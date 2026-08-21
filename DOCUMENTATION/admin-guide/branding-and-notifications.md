# Studio branding & team notifications

> Updated: 2026-08-21

Branding is split across three admin tabs, which is worth knowing before hunting for a
field: the **accent colour** and the Slack webhook are in *Studio → Settings*, the
**studio logo** is in *Review contexts → Delivery*, and the sign-in page layout is in
*Studio → Login page*.

## Studio theme

- **Accent colour** — `Setting.studio_accent`, a `#RRGGBB` value written through
  `PUT /api/studio/settings` (`ADMIN`). The picker offers **`#00b3c4`** (cyan) when
  nothing is stored. It drives the interface primary colour (buttons, links, focus
  rings) across the app **and the sign-in page**.
  *Reset* stores an **empty value**, which removes the override and lets the built-in
  theme tokens apply again — it does not write the default hex back.
  The change takes effect after a reload: the branding response is cached for five
  minutes and the accent is also cached in the browser's local storage so the colour
  is applied before the first paint.
- **Studio logo** — uploaded in *Review contexts → Delivery* and stored in
  `Setting.studio_logo_key`. The same logo is used on the sign-in screen, the client
  share page and the optional FFmpeg burn-in. Constraints (PNG/JPEG/WebP only, SVG
  refused, no size limit) are documented in
  [Secure distribution](secure-distribution.md#studio-logo).
- **Sign-in page** — *Studio → Login page* (`ADMIN`) sets the layout (`split` or
  `centered`, default `split`), an optional background image, its fit (`cover` or
  `contain`), an overlay opacity (0–0.95, default **0.45**), a blur (0–24, default
  **0**), a tagline (≤ 200 characters) and whether the logo is shown (default on).

### The public branding endpoint

`GET /api/studio/branding` is served **without authentication** — it has to be, since
it styles the login page. It returns the studio name, the accent, a presigned logo
URL, the full login-page appearance including a presigned background URL, and
`sourceUrl`.

Treat everything in that payload as public. The studio name, the tagline and the
background image are visible to anyone who can reach the instance, including before
they log in. `sourceUrl` is there because AGPL §13 requires offering the corresponding
source to remote users, authenticated or not — see
[System & maintenance](system-and-maintenance.md#source-code-url-agpl-13).

## Team chat notifications (Slack / Discord)

ReView can post short messages to a team channel on key events.

| Target | Where it is configured | Stored in |
|--------|------------------------|-----------|
| **Slack** | *Admin → Studio → Settings* → "Slack webhook (notifications)" | `Setting.slack_webhook_url` |
| **Discord** | **No UI** — `PATCH /api/studio` (`ADMIN`) with `discordWebhookUrl` | `Studio.discordWebhookUrl` |

Both URLs are validated against a strict host allowlist (anti-SSRF): HTTPS only, and
the host must be `hooks.slack.com` for Slack or `discord.com` / `discordapp.com` for
Discord. Anything else is rejected at save time (`400 BAD_WEBHOOK` for Discord) and
never contacted.

What triggers a message:

- **Both channels** — a media is published, and a review decision is recorded.
- **Discord only** — a new root comment on a media, and new feedback on a timeline.
  Slack never receives these.

Delivery is fire-and-forget with a 5-second timeout: a dead webhook is logged and
never blocks or fails the action that triggered it.

Security notes:

- The Discord webhook URL is a **secret** — anyone holding it can post into the
  channel. `GET /api/studio` therefore returns it only to an `ADMIN`; everyone else
  gets a `hasDiscordWebhook` boolean.
- Changing it is audited as `STUDIO_UPDATE`, recording only that it changed — **never
  the URL itself**. A readable audit log must not become the new hiding place for the
  secret.
- Notifications carry the media name, the version name and the decision label. If shot
  codes or version names are themselves confidential, do not route them to a chat
  workspace with a wider membership than the project.

## Browser push (Web Push)

Push notifications work out of the box. If **`VAPID_PUBLIC_KEY`** and
**`VAPID_PRIVATE_KEY`** are not both set in the environment, a VAPID key pair is
generated on first use and persisted in the database under `Setting.vapid_keys`.
`VAPID_SUBJECT` is optional and defaults to `mailto:admin@review.local`.

- For production, **set the environment variables**. Keys generated at runtime live in
  the database; restoring an older database snapshot, or running more than one
  instance against different databases, changes the key pair and silently invalidates
  every existing browser subscription.
- `vapid_keys` and `smtp_config` are the two settings that are **never readable
  through `GET /api/studio/settings` and never writable through
  `PUT /api/studio/settings`** (`400 RESERVED_SETTING`). The private VAPID key signs
  every push notification of the instance; it has no business appearing in a settings
  dump.
- Users opt in from **Profile → Notifications**, alongside the email digest and the
  weekly report. Subscriptions that the push service reports as gone (HTTP 404/410)
  are pruned automatically.
- A user can only unsubscribe their own browser — the endpoint is scoped to the
  calling account.

Studio-wide announcements and outgoing mail are a separate feature — see
[SMTP & announcements](smtp-and-announcements.md).

---

## Use case: white-labelling the instance for a studio

1. *Studio → Settings*: set the accent to the studio colour and save. Reload to see
   it — the branding response is cached for five minutes.
2. *Review contexts → Delivery*: upload the logo. Remember it is **not** SVG-capable,
   and that the same file is reused for the login page, the client portal and the
   burn-in; export it at a size that still reads when scaled into a video corner.
3. *Studio → Login page*: choose the layout, add a background and a tagline. Keep the
   overlay opacity high enough that the form stays legible over the image — 0.45 is
   the default for that reason.
4. Check the result **logged out**, in a private window. Everything on that page is
   public.
5. If you have modified the code, fill `studio_source_url` in *Settings* now: the
   login page is exactly the "remote user" surface the AGPL clause is about.

## Use case: wiring the studio Discord without an admin screen

*Production wants publish notifications in a Discord channel, and there is no field
for it.*

1. Create an incoming webhook in Discord and copy the URL.
2. There is **no UI**. Call `PATCH /api/studio` as an `ADMIN` with
   `{ "discordWebhookUrl": "https://discord.com/api/webhooks/…" }`. A URL on any other
   host is rejected with `400 BAD_WEBHOOK`.
3. Verify by publishing a test media — the message is fire-and-forget, so a wrong URL
   fails silently in the server log rather than surfacing an error in the UI.
4. Note the asymmetry before promising anything: Discord also receives new comments
   and timeline feedback; Slack receives only publications and review decisions.
5. To remove it, send `{ "discordWebhookUrl": null }`.

## Use case: push notifications stopped working after a restore

*Users report that browser notifications went quiet after the database was restored.*

1. Check whether `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` are set in the environment.
   If they are not, the pair in use came from `Setting.vapid_keys`, and the restore
   brought back a different one.
2. Every existing subscription was signed against the old key and is now invalid.
   There is no server-side fix: affected users must toggle push off and on again from
   *Profile → Notifications*.
3. Set the environment variables to the pair you want to keep — read the current one
   out of the `vapid_keys` setting row if the subscriptions are worth preserving — and
   restart. From then on restores are harmless.

## Related pages

- [Secure distribution](secure-distribution.md) — studio logo, watermark, burn-ins
- [SMTP & announcements](smtp-and-announcements.md)
- [System & maintenance](system-and-maintenance.md)
- [Identity, API & audit](identity-and-api.md)
