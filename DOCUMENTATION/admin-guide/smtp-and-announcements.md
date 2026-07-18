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
