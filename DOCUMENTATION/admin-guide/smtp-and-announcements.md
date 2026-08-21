# SMTP & announcements

> Updated: 2026-08-21

Two unrelated ways of reaching everyone in the studio: outgoing mail, and in-app
announcements. Both live under **Administration → Communications**.

## SMTP

**Administration → Communications → SMTP** configures the outgoing relay: host, port,
secure connection (TLS), user, password and the sender address shown as `From`
(`ReView <no-reply@example.com>`).

- The password is **write-only**: it is encrypted at rest and never returned by the API.
  Leaving the field untouched (`•••••• (unchanged)`) keeps the stored value.
- **Send a test email to…** delivers a short message to any address using the effective
  configuration. It reports a failure rather than pretending: a `400` with
  `SMTP_SEND_FAILED` means either "nothing configured" or "the relay refused it".
  The test message is written in the language of the administrator who triggered it.
- Environment variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
  `SMTP_PASS`, `SMTP_FROM`) **take precedence** over the stored configuration. When
  `SMTP_HOST` is set, the panel says so and the stored host, port, secure flag and user
  are ignored. This is the operator escape hatch — use it to point a staging instance at a
  capture relay without touching the database.
- Defaults when nothing is stored: port `587`, TLS off (i.e. STARTTLS on 587).
- Changing the relay is recorded in the audit log (`SMTP_UPDATE`), with the host and
  whether the password changed — never the password itself. Whoever controls the outgoing
  relay can divert every message the instance sends, so the change is traceable.

### What stops working without a relay

| Feature | Without SMTP |
|---|---|
| Creating a user by invitation | Refused up front (`SMTP_NOT_CONFIGURED`) — the account is not created at all. An account created without its activation email is reachable by nobody and holds the address hostage |
| Re-sending an invitation | Same refusal. If the relay accepts the request but delivery fails, the invitation row survives so it can be re-sent once the relay is fixed |
| **Load the ShotGrid crew** | The panel says so and disables the action before you click |
| Daily digest | Not sent |
| Weekly supervisor report | Not sent |
| The SMTP test itself | Refused, with `SMTP_SEND_FAILED` |

Invitations also need `APP_URL` to be set — without it the link in the message would point
nowhere, so the request is refused with `APP_URL_MISSING` before anything is written.

Nothing else depends on the relay: in-app notifications, Socket.io events and browser push
go through their own channels.

## Announcements

**Administration → Communications → Announcements** publishes banners at the top of the
**home page**, above the widgets. Everyone who opens the home page sees the ones that
apply to them; closing a banner records a read receipt.

Each announcement carries:

| Field | Values | Notes |
|---|---|---|
| **Title** | 1–200 characters | Shown in bold |
| **Message body** | 1–5000 characters | Plain text; line breaks are preserved, no HTML or Markdown |
| **Type** | *Info*, *Warning*, *Maintenance* | Only changes the colour and icon (blue / amber / red) |
| **Frequency** | *Permanent (on every open)*, *First login (once)*, *First of the day* | Governs when a closed banner comes back |
| **Target** | Any set of roles; **no tick = everyone** | Filtered server-side, never in the browser |
| **Start / end** | Optional timestamps | Empty start = immediately, empty end = no expiry |
| **Active** | On / off | An inactive announcement is kept but never shown |

Creating, editing and deleting announcements is **administrator-only**, and each operation
is written to the audit log. The list shows how many people have read each one
(*read by 23*), which is the closest thing to a delivery receipt.

### How frequency actually behaves

Closing a banner posts a read receipt; the frequency decides what that receipt means.

| Frequency | After the reader closes it |
|---|---|
| Permanent | Comes back on the next page load — it stays until the announcement is deactivated or expires |
| First login | Never comes back for that person |
| First of the day | Comes back on the next **UTC** calendar day |

*First of the day* is evaluated in UTC rather than in the reader's timezone, so that a
studio spread over several timezones sees the same banner on the same day.

### Use cases

**Announcing a maintenance window.** Type *Maintenance*, frequency *First of the day*,
start now, end at the beginning of the window, no role targeting.

> **Storage maintenance — Saturday 22:00 to Sunday 02:00 CEST**
> Uploads and transcoding will be unavailable. Reviews already published stay readable.
> Publish anything due Monday before Friday evening.

*First of the day* is the right choice here: a permanent banner during a week-long
countdown gets ignored by day three, while *first login* would miss everyone who was
already logged in when you posted it. Set the **end** date to the start of the window so
the banner removes itself — a stale maintenance notice teaches people to ignore the next
one.

**Announcing a new version.** Type *Info*, frequency *First login (once)*, no target, no
end date.

> **ReView 2.14 — status from the right-click menu**
> Right-click a shot, a sequence, a kanban card or a task to change its status without
> opening its page. Press `?` for the full list of shortcuts.

Shown once per person, then gone. For the running list of changes, the **What's new**
panel in the sidebar footer is the better home; use an announcement when you want the
change actively noticed once.

**Reaching supervisors only.** Type *Warning*, frequency *Permanent*, target ticked on the
supervisor role (add the administrator role if they should see it too).

> **Approve the dailies before 16:00**
> The delivery build starts at 16:30. Anything left undecided ships as the previous
> approved version.

Targeting is applied on the server: an artist's browser never receives the announcement,
so a targeted message is genuinely private to those roles. Remember that role targeting
matches the **global** role of the account, not a per-project role — someone who is a
supervisor on one project but an artist studio-wide will not see it.

**Freezing a period.** Type *Warning*, frequency *Permanent*, with a start and an end
timestamp — the banner appears and disappears on its own, so nobody has to remember to
take it down.

### Related pages

- [Admin overview](overview.md)
- [Users & roles](users-and-roles.md)
- [ShotGrid integration](shotgrid-integration.md) — the crew invitation depends on SMTP

---

## Message format

Every email ReView sends goes out in two versions at once: HTML and plain text. The text
version is derived from the HTML, so the two cannot drift apart. This matters more than it
looks: spam filters penalise HTML-only messages, and every preview surface — the inbox
list, a watch notification, a screen reader — renders the text version, not the HTML.

The HTML is built on nested tables rather than `<div>`s. Outlook on Windows renders mail
with the Word engine, which ignores most modern layout; a table is the only structure it
lays out predictably.

Each message opens with a **preheader**: one hidden line that mail clients show next to the
subject in the inbox list. Without it, clients pick the first visible words — usually
"View this in your browser" or a greeting, which tells the reader nothing.

## Headers

- `Auto-Submitted: auto-generated` and `X-Auto-Response-Suppress: All` on **every** message.
  Without them an out-of-office responder answers the daily digest, and depending on the
  relay the loop can close on itself.
- `List-Unsubscribe` and `List-Unsubscribe-Post` on **recurring** messages only (daily
  digest, weekly report). Mail clients turn them into their own Unsubscribe button.

That button matters for deliverability. A reader who no longer wants the digest and has no
unsubscribe link has exactly one gesture within reach: marking the message as spam — which
damages the reputation of *every* email the studio sends, invitations included.

## One-click unsubscribe

The unsubscribe link carries a signed token: it identifies one account and one kind of
recurring email, nothing more. It opens no session, reveals nothing about the account, and
a forged token does nothing.

The token is `<userId>.<kind>.<HMAC signature>` — readable, verifiable, and stateless.
Only two kinds exist, `emailDigest` and `weeklyReport`; anything else is rejected before
the signature is even checked, and the signature comparison is constant-time so the
response delay leaks nothing.

Following the link by hand shows a short confirmation page. Clicking the client's native
button calls the same address without any page — nobody would read it.

Unsubscribing switches off one preference. The reader can turn it back on at any time from
their ReView profile.

The unsubscribe page is reachable without signing in, so it carries the **Source code**
notice required by AGPL §13.
