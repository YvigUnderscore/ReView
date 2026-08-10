# Messaging & member profiles

> Updated: 2026-08-10

Studio members can look each other up and talk directly inside ReView — no side channel,
no context switch. Everything lives in the **presence panel**, at the bottom of the sidebar.

## Who is around

The presence panel lists every account of the studio (service accounts excluded), online
members first, each with its status dot (available / away / do not disturb) and last-seen
time. Click a person to get two actions:

- **View profile** — opens their member page.
- **Send a message** — opens a private conversation (creating it if needed).

## Member profile

The profile page (`/users/<id>`) shows the identity, job title, short bio, current status
and the projects you have in common. Contact details (email, phone) are visible to internal
accounts only: a **CLIENT** account sees who it is talking to, not the studio address book.

Your own fields are edited in **Profile** (`/profile`): first/last name, username, job
title, phone and bio. They are kept across reloads and shown on your member page.

## Conversations

Below the presence list, the **Messages** section holds your threads, most recently active
first, each with its unread badge.

- **Direct message** — one recipient. Writing to the same person twice reopens the existing
  thread instead of splitting the history.
- **Group** — the `+` button opens the picker: name the group (optional) and select the
  people. Adding someone to a direct message turns it into a group, announced in the thread.

Clicking a thread opens the conversation window, anchored next to the sidebar. It follows
you as you navigate, so you can answer without leaving a review.

In the window you can:

- write (**Enter** sends, **Shift+Enter** adds a line),
- add people, rename a group, mute it, or leave it,
- delete your own messages (they disappear for everyone),
- scroll up and load earlier messages.

Messages arrive in real time. When you are offline, a browser notification is sent instead
(unless the thread is muted) — see [account-security.md](account-security.md) for how push
notifications are enabled.

A thread is private to its members: nobody else can read it or write to it, whatever their
role. Leaving a group removes your access; when the last member leaves, the thread is
deleted with its messages.
