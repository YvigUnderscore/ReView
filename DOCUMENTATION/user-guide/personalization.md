# Personalization & everyday UX

> Updated: 2026-08-21

ReView adapts to how you work. Most of these settings live in your **Profile** or behind
right-click / keyboard shortcuts — the interface stays uncluttered.

## Display preferences

Open **Profile → Display**:

- **Theme** — *System* (follows your OS light/dark setting), *Light*, or *Dark*.
- **Density** — *Comfortable* (default) or *Compact* to fit more on screen. Density scales
  the root font size, so every text size in the interface follows.
- **Language** — fourteen languages, English first. The interface switches instantly.

These three are stored **in the browser**, applied before the first paint, so there is no
flash on reload. They are per-browser rather than per-account: the same person gets
compact density on the review workstation and comfortable density on a laptop, which is
usually what you want.

An administrator can set a **studio default** for language and theme
(*Administration → Settings*). The default applies to accounts that have not chosen for
themselves — including for the emails sent to them — and yours always wins once you pick.

**Use case.** A colourist checks a shot on a calibrated display: *Dark* theme, *Compact*
density, so the media occupies the maximum area and the surrounding chrome stays neutral.

## Keyboard shortcuts (configurable)

Press **?** anywhere to open the shortcuts cheat sheet. The **Navigation** shortcuts are
**editable**: click a key to record a new one. Your custom bindings are saved to your
account, so they follow you to any browser.

- `Ctrl/⌘ + K` — command palette (global search & navigation).
- `g` then `p` — go to Projects.
- `g` then `k` / `b` — go to Kanban / Board of the current project.
- `?` — the cheat sheet itself.

The `g` leader is fixed; only the second key is rebindable, and it must be a single
character other than `g`. A key already used by another shortcut is refused rather than
silently shadowing it. `g k` and `g b` only apply inside a project.

Review shortcuts (playback, frame stepping, annotation, gizmos) are listed in the same
sheet and documented per viewer — see [Review workspace](review-workspace.md).

## Favorites

Right-click a **project, sequence, shot or asset** and choose **Pin to favourites**. Pinned
items show a star and appear in the **Favourites** section of the sidebar. Right-click again
to unpin.

Favourites are per-account and re-checked against your access: a pin on a project you lose
access to, or on an entity that was trashed, simply stops appearing.

**Use case.** During a crunch week, pin the four shots you own. They sit at the top of the
sidebar on every page, so returning to one costs a click instead of a search.

## Saved list views

A **view** is a named set of filters. On the **Reviews** list, and on the **Kanban**,
**Shots** and **Assets** lists of a project, set the filters you want (project, type,
status, decision, department…), then open the **Views** menu and name the current view.

- Recall a saved view in one click; the active one is highlighted.
- Saving under an existing name replaces it — matching is case- and whitespace-insensitive,
  so *"My retakes"* and *"my retakes "* are the same view.
- Empty filters are dropped before saving, so two views built differently but filtering
  identically compare as equal.
- Views are stored on your **account**, and separately per list.

**Use case.** A supervisor keeps two views on the Reviews list: *"Waiting on me"* (status
= in review, no decision) and *"Retakes this week"*. Switching between the two is one
click, instead of three dropdowns.

## Resume where you left off

The home page shows a **Resume** card with your last reviewed media and your last opened
task, so you can jump straight back in.

## What's new

The **What's new** panel (sparkle icon in the sidebar footer) lists recent product updates.
A dot signals unread entries; opening the panel marks them as read. When the changelog
cannot be fetched, the panel says so rather than showing an empty list.

For a change you want actively noticed once, an administrator can also post an
[announcement](../admin-guide/smtp-and-announcements.md#announcements) — it appears as a
banner on the home page.

## Onboarding

On first sign-in, a short guided tour introduces navigation, reviewing, personalization and
help. You can skip it at any time; it won't show again.

## Enriched profile

Under **Profile → Identity** you can add a **job title**, a short **bio** and a **phone
number** in addition to your name, username and avatar. These appear on your member page
for colleagues — see [Messaging & member profiles](messaging-and-profiles.md).

## Notifications

Under **Profile → Notifications**:

- **Browser push notifications** — alerts even when ReView is not the active tab (new
  comments, review decisions, published media, direct messages). Enabling asks the browser
  for permission; refusing it there is reported back rather than failing silently, and the
  toggle is disabled outright on a browser that does not support push. The server generates
  and stores its signing key pair on first use, so no configuration is required for this to
  work.
- **Email preferences** — the **daily digest** and, for supervisors and administrators, the
  **weekly production report**. Both are **opt-in**: nothing is emailed until you turn it
  on. They are also the only two recurring messages, so they are the ones carrying a
  one-click unsubscribe link — using your mail client's Unsubscribe button flips exactly
  the same switch you see here, and you can turn it back on from this page.

**Use case.** An artist who lives in a DCC all day enables push for comments and leaves the
daily digest off: the alert that matters arrives immediately, and the recap that does not,
never arrives at all.

## Related pages

- [Account security](account-security.md)
- [Navigation & search](navigation-and-search.md)
- [Review workspace](review-workspace.md)
