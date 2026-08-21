# Messaging & member profiles

> Updated: 2026-08-21

Studio members can look each other up and talk directly inside ReView — no side channel,
no context switch. Everything lives in the **presence panel**, at the bottom of the sidebar.

## Who is around

The presence panel lists the accounts you are entitled to see, online members first, each
with its status dot (available / away / do not disturb) and last-seen time.

- **Internal accounts** (artist, supervisor, administrator) see the whole studio — they
  work there.
- **CLIENT accounts** see only the people from the projects they share. An external
  reviewer needs to know who is in the room, not the studio's address book.
- **Service accounts** (render farm tokens, bots) never appear: a machine has nobody to
  talk to.

Email addresses are stripped from this list for everyone, whatever the role.

Click a person to get two actions:

- **View profile** — opens their member page.
- **Send a message** — opens a private conversation (creating it if needed).

Set your own status from your avatar in the sidebar footer: *available*, *away* or
*do not disturb*.

## Member profile

The profile page (`/users/<id>`) shows the identity, job title, short bio, current status
and the projects you have in common. Contact details (email, phone) are visible to internal
accounts only: a **CLIENT** account sees who it is talking to, not the studio address book.
The shared-projects list is an intersection, so it never reveals a project the reader
cannot already see.

Your own fields are edited in **Profile** (`/profile`): first/last name, username, job
title, phone and bio. They are kept across reloads and shown on your member page.

The displayed name falls back through what is available — username, then the stored full
name, then first + last name, then the email address — so a half-filled profile still shows
something readable rather than a blank.

## Conversations

Below the presence list, the **Messages** section holds your threads, most recently active
first, each with its unread badge. A single badge on the sidebar sums the unread count of
every thread.

- **Direct message** — one recipient. Writing to the same person twice reopens the existing
  thread instead of splitting the history: without that, two people who message each other
  regularly end up with as many threads as clicks, each holding part of the conversation.
- **Group** — the `+` button opens the picker: name the group (optional) and select the
  people. Naming a thread makes it a group even with a single recipient.

Adding someone to a direct message **turns it into a group**, and the newcomers can read
the history. That is what "opening up a thread" means, and a service line in the thread
records it — as it does for departures and renames.

Clicking a thread opens the conversation window, anchored next to the sidebar. It follows
you as you navigate, so you can answer without leaving a review.

In the window you can:

- write (**Enter** sends, **Shift+Enter** adds a line),
- add people, rename a group, mute it, or leave it,
- delete your own messages — only the author can, and they disappear for everyone,
- scroll up and load earlier messages.

A one-to-one thread cannot be left; leave is a group gesture. Removing someone else is
possible in a group only.

Messages arrive in real time. When you are offline, a browser push notification is sent
instead — unless the thread is muted, which silences the push while keeping the thread and
its unread count. Enabling push is described in
[Personalization → Notifications](personalization.md#notifications).

A thread is private to its members: nobody else can read it or write to it, whatever their
role — a non-member request is refused, not merely hidden. Leaving a group removes your
access; when the last member leaves, the thread is deleted with its messages, since a
thread nobody can read is only orphaned data.

## Use cases

- *Reaching the person who left the note.* Open the comment, click the author's avatar,
  **Send a message** — the thread reopens if you have written before, so the context is
  already there.
- *A group for one retake.* Create a group named after the shot with the artist, the
  supervisor and the coordinator. When it is delivered, everyone leaves and the thread
  disappears on its own.
- *Reviewing with an external client.* The client sees only the people from the shared
  project in the presence panel, so they cannot accidentally address the whole studio.
- *Focusing.* Mute a busy group rather than leaving it: you keep the history and the unread
  count, and stop getting push notifications for it.

## Related pages

- [Personalization](personalization.md)
- [Annotations & comments](annotations-and-comments.md)
- [Users & roles (admin)](../admin-guide/users-and-roles.md)
