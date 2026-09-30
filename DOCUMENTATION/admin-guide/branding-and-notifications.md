# Studio branding & team notifications

*Where each branding field lives, what a signed-out visitor can see, and how team chat and browser alerts are wired.*

> Updated: 2026-09-20

An instance of ReView is one studio, and it should look like that studio from the sign-in page
onwards. Three admin screens and one API-only field carry everything visible: the studio name,
the accent colour, the logo, the appearance of the login page and the source-code link the
licence requires.

The same page covers the two channels that push events *out* of the application — a team chat
webhook and browser notifications — because they share the property that makes them worth
documenting carefully: they are configured once, they fail silently, and one of them is a
secret.

## Where each branding value lives

![Seven values spread over three admin screens; the studio name, accent, logo, login page and source-code URL are all public, the two chat webhooks are internal, and five of the seven are set on one screen.](../assets/admin-guide/branding-field-map.svg)

The split is short now. *Studio → Studio identity* holds five of the seven: the **name**, the
**accent colour**, the **logo**, the default **language** and the **source-code URL**. The sign-in
page is next door, in *Studio → Login page*, because it is a layout rather than an identity. The
two **chat webhooks** are in *Communications → Team chat*. The logo used to be uploaded from
*Review contexts → Delivery*, on the reasoning that it is a delivery asset; it is also what a
signed-out visitor sees on the sign-in page, so it moved to the identity screen and *Delivery*
now carries a pointer to it.

The first five rows of the figure are rows of the generic `Setting` key/value table, written
through `PUT /api/studio/settings` (`ADMIN`, audited as `SETTING_UPDATE` with the key — never
the value). The last two live on the `Studio` record itself.

> [!NOTE]
> Renaming the studio now has a field, at the top of *Studio identity*. It still writes
> `PATCH /api/studio` with `{ "name": "…" }` as an `ADMIN`, between 2 and 120 characters, and it is
> the only field on that screen the server can refuse — so the page saves the name first and
> leaves everything else untouched if it comes back refused. The slug derived at setup does not
> follow the rename, and the name is what a signed-out visitor reads on the sign-in page.

## The studio theme

**Accent colour** — `studio_accent`, a `#RRGGBB` value. The picker offers **`#00b3c4`** (cyan)
when nothing is stored. The accent overrides the interface primary colour — buttons, links,
focus rings — across the whole application **and the sign-in page**. The readable ink on top of
it is derived from its luminance rather than fixed, so a dark accent does not leave an
unreadable label on a coloured button in one of the two themes.

*Reset* stores an **empty value**, which removes the override and lets the built-in theme tokens
apply again; it does not write the default hex back. The change lands on the next load: the
branding response is kept for five minutes by the client cache, and the accent is also mirrored
in the browser's local storage so it can be applied before the first paint instead of flashing.

**Studio logo** — uploaded in *Review contexts → Delivery*, stored as `studio_logo_key`. The
upload is presigned (`branding/logo-<timestamp>.<ext>`, a 15-minute `PUT`), then the key is
saved as a setting; removing the logo writes an empty key. The same file is reused on the
sign-in screen, the client share page and the optional FFmpeg burn-in — export it at a size that
still reads when scaled into a video corner. PNG, JPEG and WebP only: **SVG is refused**,
deliberately, because a scriptable document uploaded by an admin has no business being served
from the application's own origin. Details in
[Secure distribution](secure-distribution.md).

**Sign-in page** — *Studio → Login page* (`ADMIN`) is a partial patch: every field is optional
and what you do not send stays as it was.

| Field | Values | Default |
|---|---|---|
| Layout | `split` or `centered` | `split` |
| Background image | presigned upload, `branding/login-bg-<timestamp>.<ext>` | none — an accent gradient |
| Background fit | `cover` or `contain` | `cover` |
| Overlay opacity | 0 to 0.95 | **0.45** |
| Blur | 0 to 24 pixels, integer | **0** |
| Tagline | free text, 200 characters maximum | empty — a translated default is shown |
| Show the logo | on / off | on |

> [!TIP]
> The overlay and the blur are not decoration: a bright photograph under a bright form makes the
> fields unreadable, and no admin should have to retouch an image for that. `0.45` is the
> default for exactly this reason — lower it only after checking the form against your own
> image, signed out.

Saving the appearance is audited as `SETTING_UPDATE` on the key `login_appearance`.

## The public branding endpoint

`GET /api/studio/branding` is served **without authentication** — it has to be, since it styles
the login page. It returns the studio name, the accent, a presigned logo URL, the full login
appearance including a presigned background URL, `sourceUrl`, whether password login is
enabled, and `draftMode`.

`draftMode` travels here for want of anywhere else. It is a routing boolean, not a secret: an
artist has to know whether *Publish* is still a gesture in this studio, and the administration
settings that hold the switch are readable by administrators only. This endpoint is the one
channel everybody can read. See
[Pipeline settings](pipeline-settings.md#draft-mode-and-the-upload-note) for what the switch
changes.

Treat everything in that payload as public. The studio name, the tagline and the background
image are visible to anyone who can reach the instance, including before they log in. If your
tagline names a client or a show under NDA, it is now on the open internet.

`sourceUrl` is there because the AGPL §13 requires offering the corresponding source to remote
users, authenticated or not. Empty, it falls back to the upstream repository; filled, it must be
an `http`/`https` URL, or it falls back too. See
[System & maintenance](system-and-maintenance.md).

## Team chat notifications

ReView can post one-line messages into a team channel on key events.

| Target | Where it is configured | Stored in |
|---|---|---|
| **Slack** | *Admin → Communications → Team chat* | `slack_webhook_url` |
| **Discord** | *Admin → Communications → Team chat* — the same screen, one save bar; still `PATCH /api/studio` with `discordWebhookUrl` underneath | `Studio.discordWebhookUrl` |

![Publications and decisions go through notifyChat to both Slack and Discord; comments and timeline feedback go through sendDiscord to Discord only. Both paths abort after five seconds and render their message from the translation catalogues.](../assets/admin-guide/chat-notification-routing.svg)

Both URLs are checked against a strict host allow-list before anything is posted: HTTPS only,
and the host must be `hooks.slack.com` for Slack, or `discord.com` / `discordapp.com` for
Discord. Anything else is never contacted. **When that check happens differs**, and it matters
when you debug a channel that stays quiet:

- The **Discord** URL is validated at save time — `PATCH /api/studio` answers `400 BAD_WEBHOOK`
  on any other host, so a typo is caught while you are still looking at it.
- The **Slack** URL is an ordinary setting. It is stored as typed, with no validation, and only
  the allow-list at posting time rejects it. A wrong host is therefore accepted silently and
  simply never posts.

What triggers a message, and along which path:

| Event | Slack | Discord | Timeout |
|---|---|---|---|
| A media is published | yes | yes | 5 seconds |
| A review decision is recorded | yes | yes | 5 seconds |
| A new root comment on a media | no | yes | 5 seconds |
| New feedback on a timeline | no | yes | 5 seconds |

Both paths are fire-and-forget: the failure is logged and never blocks or fails the action that
triggered it, and both abort the request after five seconds. Both also resolve the webhook host
to an address before posting and refuse to follow a redirect, so a webhook whose name points
back into the application network never causes an outbound request. A webhook you no longer use
is still worth removing rather than leaving it pointing at a deleted channel: every event then
buys a refused request and a log line for nothing.

The message itself carries the media name, the version name and the decision label. It is
rendered from the translation catalogues in the **studio default language** — the language set
in *Administration → General*, not the language of whoever triggered the event. A channel is
collective: nobody in a Slack room has a language of their own.

> [!CAUTION]
> A webhook URL is a **secret**: anyone holding it can post into the channel. `GET /api/studio`
> therefore returns `discordWebhookUrl` only to an `ADMIN`; everyone else gets a
> `hasDiscordWebhook` boolean. Changing it is audited as `STUDIO_UPDATE` recording only *that*
> it changed — never the URL — because a readable audit log must not become the new hiding place
> for the secret. And since notifications carry shot codes and version names, do not route them
> to a workspace with a wider membership than the project.

Both webhooks now go through the shared `safeFetch` guard, like every other outgoing request:
resolved-address check, refusal to follow a redirect, a 5 s header timeout and a byte cap on
the reply. The host allow-list is still applied first, but it only ever vetted the URL you
typed — which is exactly why the guard underneath it was needed. A 4xx from the channel
(deleted webhook, malformed payload) is logged with its status rather than swallowed.

## Which events notify, and on which channel

A notification is written only if the recipient has left its **kind** open on that **channel**.
The kinds are a closed registry rather than a free string, because `User.preferences` is a JSON
bag with no schema: without a registry every call would invent its own key, nobody could list
them, and the profile screen would show what it believed rather than what the server reads.

| Kind | Fires when | `Notification.type` |
|---|---|---|
| `mention` | Someone writes your name in a note | `MENTION` |
| `reply` | Someone answers in your thread | `REPLY` |
| `commentAssigned` | A note is addressed to you | `COMMENT_ASSIGNED` |
| `taskAssigned` | A task is assigned to you | `TASK_ASSIGNED` |
| `reviewAssigned` | A version is handed to you to review | `REVIEW_ASSIGNED` |
| `reviewDecision` | A decision is recorded on something you delivered | `REVIEW_DECISION` |
| `watch` | Something you watch moves | `WATCH` |
| `live` | A live review session opens | `LIVE` |

Two channels are settable per kind: **`inApp`** (the bell) and **`push`** (the browser). Each
reader arranges them in *Profile → Notifications*; there is no studio-wide override, and an
administrator cannot notify past someone's choice.

Three properties are worth knowing before you debug a missing notification:

- **Only an explicit `false` closes a channel.** An absent bag, a kind never touched, a value of
  an unexpected shape — all let the notification through. An unreadable setting must not quietly
  silence something nobody asked to silence, and a kind added later therefore arrives switched
  on for everyone.
- **The `type` is derived from the kind, never passed in.** It used to be a free string, which
  is how one review decision came to be written `review_decision` where everything else is
  upper-case — a type the front end did not recognise, so a click that never opened the review.
- **The registry is duplicated on purpose**, in `backend/src/lib/notificationKinds.ts` and
  `frontend/src/v2/lib/notificationKinds.ts`, and a test fails if the two copies drift. Same
  contract as `i18n/locales.json`.

> [!NOTE]
> Team chat is not affected by any of this. A Slack or Discord message goes to a channel, not
> to a person, so it has no per-recipient setting and is rendered in the studio language.

## Browser push

Push notifications work out of the box. If **`VAPID_PUBLIC_KEY`** and **`VAPID_PRIVATE_KEY`**
are not both set in the environment, a VAPID key pair is generated on first use and persisted in
the database under `Setting.vapid_keys`. `VAPID_SUBJECT` is optional and defaults to
`mailto:admin@review.local`.

![With the two VAPID variables set, the same key pair survives restores and replicas; without them the generated pair lives in the database, and restoring it changes the pair and invalidates every browser subscription.](../assets/admin-guide/vapid-key-lifecycle.svg)

> [!IMPORTANT]
> `vapid_keys` and `smtp_config` are the two settings **never readable through
> `GET /api/studio/settings` and never writable through `PUT /api/studio/settings`**
> (`400 RESERVED_SETTING`). The private VAPID key signs every push notification of the instance;
> it has no business appearing in a settings dump.

Users opt in from **Profile → Notifications**, next to the daily email digest and the weekly
production report. The browser asks for permission, subscribes to its own push service, and
sends the resulting endpoint to `POST /api/push/subscribe`.

That endpoint is a URL the server will later call **from inside the application network**, so it
is put through the outgoing-request guard before being stored: the host is resolved, and any
name that resolves to a private or link-local address is refused with
`400 PUSH_ENDPOINT_REFUSED`. That is the failure to look for when a user says they cannot enable
notifications — typically a browser behind a corporate proxy that rewrites the push endpoint to
an internal host. The same check runs again at send time, because a row may predate the guard
and a public name can start resolving elsewhere.

Two more properties worth knowing:

- Subscriptions the push service reports as gone (HTTP 404 or 410) are **pruned automatically**
  on the next send. Nothing to clean up by hand.
- A user can only unsubscribe **their own** browser: the endpoint is scoped to the calling
  account, so knowing someone else's endpoint is not enough to silence them.

Studio-wide announcements and outgoing mail are a separate feature — see
[SMTP & announcements](smtp-and-announcements.md).

## Use cases

### White-labelling the instance for a studio

1. *Studio → Studio identity*: set the name and the accent, upload the logo, and save — one bar
   commits the screen. Reload to see the accent — the branding response is cached for five minutes.
   The logo is **not** SVG-capable, and the same file is reused for the login page, the client
   portal and the burn-in.
3. *Studio → Login page*: choose the layout, add a background and a tagline. Keep the overlay
   opacity high enough that the form stays legible over the image.
4. Check the result **signed out**, in a private window. Everything on that page is public.
5. If you have modified the code, fill the source-code URL in *Settings* now: the login page is
   exactly the "remote user" surface the AGPL clause is about.

### Wiring the studio Discord

*Production wants publish notifications in a Discord channel.*

1. Create an incoming webhook in Discord and copy the URL.
2. Paste it in *Admin → Communications → Team chat*, beside the Slack field, and save. A URL on
   any other host is rejected with `400 BAD_WEBHOOK` — the Discord field is validated at save
   time, the Slack one is not (see above). The underlying call is `PATCH /api/studio` with
   `{ "discordWebhookUrl": "https://discord.com/api/webhooks/…" }`, if you would rather script it.
3. Verify by publishing a test media — delivery is fire-and-forget, so a wrong URL fails
   silently in the server log rather than surfacing an error in the interface.
4. Note the asymmetry before promising anything: Discord also receives new comments and timeline
   feedback; Slack receives only publications and review decisions.
5. To remove it, send `{ "discordWebhookUrl": null }`. Do remove it rather than leaving it
   pointing at a deleted channel: every event then buys a refused request and a log line for
   nothing. Both paths do abort after five seconds — the comment path used to have no
   timeout at all, and a relay that accepted the connection then went silent held a socket
   and the message context for good.

### Push notifications stopped working after a restore

1. Check whether `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` are set in the environment. If they
   are not, the pair in use came from `Setting.vapid_keys`, and the restore brought back a
   different one.
2. Every existing subscription was signed against the old key and is now invalid. There is no
   server-side fix: affected users must toggle push off and on again from *Profile →
   Notifications*.
3. Set the environment variables to the pair you want to keep — read the current one out of the
   `vapid_keys` row if the subscriptions are worth preserving — and restart. From then on
   restores are harmless.

### One user cannot enable notifications, everyone else can

Look for `PUSH_ENDPOINT_REFUSED` in the server log with that user's id. The browser handed over
an endpoint whose host resolves inside the network, and the guard refused to store it. It is not
an account problem and not a key problem: it is that browser, that network. Trying another
browser, or the same one off the corporate network, is the fastest way to confirm it.

## Related pages

- [Secure distribution](secure-distribution.md) — the studio logo in shares, watermarks and burn-ins
- [SMTP & announcements](smtp-and-announcements.md) — the other outgoing channel
- [System & maintenance](system-and-maintenance.md) — the source-code URL and the AGPL obligation
- [Identity, API & audit](identity-and-api.md) — outgoing webhooks with signed payloads, and the audit log
- [Users & roles](users-and-roles.md) — who holds `ADMIN`
- [Personalisation (user guide)](../user-guide/personalization.md) — what a reader can change for themselves
