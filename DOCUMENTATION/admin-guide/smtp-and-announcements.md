# SMTP & announcements

> Updated: 2026-07-18

## SMTP

*Admin → Communications → SMTP* configures outgoing mail (host, port, credentials,
sender). Used for account emails and notifications. A test-send button validates
the configuration; SMTP can also be provided through backend environment variables
(`SMTP_*`).

## Announcements

*Admin → Communications → Annonces* publishes studio-wide banners:

- **Type**: info, warning or maintenance (styling differs).
- **Frequency**: permanent (shown while active), first login (once per user), or
  first of day (once per user per day).
- Announcements can be scheduled/deactivated at any time.

## Related pages

- [Admin overview](overview.md)

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

Following the link by hand shows a short confirmation page. Clicking the client's native
button calls the same address without any page — nobody would read it.

Unsubscribing switches off one preference. The reader can turn it back on at any time from
their ReView profile.

