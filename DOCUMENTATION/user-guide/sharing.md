# Sharing with clients

*Scoped, expiring, password-protected links that show a client exactly what you published — without an account.*

> Updated: 2026-08-23

A **share link** gives someone outside the studio a way into one precise slice of a project:
a playlist, a version, a hand-picked set of media, or the whole show. They open a URL, see a
grid, play what is in it, and — if you let them — leave notes that land in the team's thread.
No account, no invitation, no navigation into the application.

Links are created and revoked in the project's **Shares** tab, by an `ADMIN` or a project
`SUPERVISOR`.

![The Shares tab, where client links are created and revoked.](../assets/user-guide/shares.png)

## What a link opens

Two things decide what a client sees: a filter that never changes, and a **scope** that you
choose when you create the link.

The filter comes first. A media is shareable only if it is **published**, its processing
status is `READY`, it belongs to a **published version**, and neither it nor its version, task,
shot, sequence or asset sits in the trash. A draft is invisible to a client whatever the scope
— publishing remains the decision that exposes work.

The scope then narrows that set.

![Every share link starts from the same filter — published media, status READY, published version, nothing in the trash — and then narrows it to the whole project, one playlist, one version, or an explicit selection of at most 200 media; a scope whose target has been deleted matches nothing rather than falling back to the whole project.](../assets/user-guide/share-scope-ladder.svg)

| Scope | Field in the dialog | What the client gets |
|-------|---------------------|----------------------|
| `PROJECT` | *The whole project* | Every shareable media of the project. The default. |
| `PLAYLIST` | *A single playlist* | Only media whose version is an item of that playlist |
| `VERSION` | *A single version* | Only the media of that one version |
| `MEDIA` | *Selected media* | An explicit list you tick, **200 maximum** |

The scope is not a display filter. It is re-applied on **every** read the client makes — the
grid, the presigned file URL, the comment thread — so a client who was shown one shot cannot
reach a sibling by guessing its id.

> [!IMPORTANT]
> A scope whose target has been deleted **matches nothing**. A link pointing at a playlist
> that no longer exists shows an empty grid; it never falls back to the whole project. That
> silent widening is exactly what the scope exists to prevent.

The target is checked against the link's project at creation, and three refusals can come back
at that moment:

| Code | Meaning |
|------|---------|
| `SCOPE_TARGET_MISSING` | A scope was chosen without its target — a `PLAYLIST` link with no playlist, a `MEDIA` link with an empty selection |
| `SCOPE_TARGET_FOREIGN` | The playlist, version or media belongs to another project, or the selection contains something that is not published |
| `SCOPE_SELECTION_TOO_LARGE` | More than 200 media in one selection |

For a `MEDIA` link the picker lists the project's **published** media only, newest first, and
an unpublished one cannot be smuggled in: a selection is refused rather than quietly becoming
visible on the day that media is published.

## Creating a link

Project page → **Shares** tab → **New link**.

| Field | Effect | Default |
|-------|--------|---------|
| **Recipient** | 1–120 characters. Shown in the list and burnt into the on-screen watermark of the client page. | empty |
| **What the link opens** | The scope, and its target — see above. | *The whole project* |
| **Permission** | *Read only* (`VIEW`) or *Read + comments* (`COMMENT`). | *Read only* |
| **Password** | 4–200 characters, hashed with bcrypt and never displayed again. | none |
| **Expiry (days)** | Whole days from creation, up to 3650. | never expires |
| **View limit** | Maximum number of viewing sessions. | unlimited |

The URL is `https://<studio>/client/<token>`, with a 48-character random token, and lands on
your clipboard as soon as the link is created.

Each row of the list then shows, at a glance: the recipient label, the permission badge, a
padlock when a password is set, the **scope badge** (*Whole project*, the playlist or version
name, or *{n} media*), the view counter (`6 / 20`), the expiry date, the last-viewed date and
who created it. The two buttons on the row copy the URL and revoke the link; right-clicking
the row offers the same two plus **Send by email…**.

> [!NOTE]
> The scope badge reads *Restricted* when a link points at something that has since
> disappeared. That is the visible face of the rule above: the link is alive, and it opens
> nothing.

## Sending the link

Right-click a link → **Send by email…**. ReView sends it through the studio's own SMTP relay,
one message per recipient — a list in plain `To:` would tell every client who else received
the same link.

- **Recipients**: one address per line, or separated by commas or semicolons. **10 maximum**
  per send. The dialog counts the valid addresses as you type.
- **Note**: up to 1000 characters, quoted in the message.
- The message states **what the link opens** (the playlist or version by name, "a selection of
  media chosen for you", or the whole project), whether it is password-protected, and either
  its expiry date or that it never expires. The dialog tells you which of those two sentences
  it will use before you send.

The e-mail is always written in **English**, deliberately: the recipient has no account and
therefore no known language preference.

> [!WARNING]
> Two configuration errors stop the send before anything leaves: `APP_URL_MISSING` — the
> studio has no public URL, so the link in the message would be unusable — and
> `SMTP_NOT_CONFIGURED`. A revoked link is refused too (`SHARE_REVOKED`). See
> [SMTP & announcements](../admin-guide/smtp-and-announcements.md).

If you would rather send it yourself, the URL is already on your clipboard from creation, and
the copy button on the row gets it back later. Send the **password on a different channel from
the link** — it is never displayed again, so if you lose it, revoke and re-create.

## One visit, one view

Opening the client page starts a **share session**: a short-lived token valid for **24 hours**,
kept in that browser tab and required by every subsequent request. **One session = one view.**

![A client opens the link, a revoked, expired or unknown token answers the same 404, a password is checked with a rate limit of ten wrong tries per quarter of an hour, and the share session that is then issued consumes one view counted atomically against the view limit; every later request re-checks the link scope before a presigned URL is handed out.](../assets/user-guide/client-visit-sequence.svg)

- The view is consumed **when the session is issued** — at the first open for a free link, at
  the successful password unlock for a protected one. A locked page that has not been unlocked
  costs nothing and reveals nothing but the studio's logo and name.
- The same person opening the link in a second tab or window consumes a **second** view. Size
  the limit accordingly, or leave it empty.
- The counter is incremented atomically against the limit, so two visitors arriving at the same
  instant cannot both slip through the last slot. When the limit is reached, new visitors get a
  clear *view limit reached* message (`410`), while **sessions already open keep working** — a
  client is never cut off mid-review.
- Because the session is required by the sub-routes, neither the password nor the view limit
  can be bypassed by calling a media URL directly.

An expired or revoked link answers **exactly like an unknown token** — the same `404` — so an
attacker cannot tell a live token from a dead one. That check runs on every request, which is
why revoking also kills the sessions already open on the link.

## What the client sees

The client page is deliberately bare: studio logo and name, the project name, a media grid, a
viewer, a comment column, and the AGPL source notice in the footer. There is **no navigation
into the application**, and the locked page carries no project data at all.

The grid lists the media of the link's scope, **newest first**, capped at 200 per page load.
Thumbnails come from presigned URLs, like everything else the page loads.

### The four kinds of media

All four viewers are mounted, in read-only form, with the watermark drawn over each of them:

| Kind | What the client gets |
|------|----------------------|
| Video | The studio's own transport, not a bare browser player: frame stepping, `J`/`K`/`L` shuttle, an `I`/`O` loop, playback speed, fullscreen, `M` to pause and start typing a note, and the comments drawn on the timeline |
| Image | The image, fitted to the viewer |
| 3D model | The review's own 3D pane — orbit, pan, right-click fly, wheel zoom, `H` for the home view. No gizmo, no transform, no reprocess |
| Gaussian splat | The review's splat pane, same navigation, without a single editing tool |

What is missing from the video player is what assumes an account: the HLS quality ladder,
shared timeline markers, annotation drawing and A/B comparison. If the media's frame rate was
never detected, the client can correct it in the transport so the frame numbers line up with
the studio's.

A line under the spatial viewers says the rest in as many words: *Read only · Orbit by
dragging · free flight on right-click · wheel to zoom · `H` Home view · Replayed exactly as
the studio staged it — nothing you change here is saved.*

> [!NOTE]
> A 3D model is served through its converted **GLB** derivative, because no browser opens an
> `.fbx`, an `.obj` or a `.usd`. If the conversion has not run, the client gets a plain "this
> media cannot be displayed here" rather than an empty frame. The public payload today carries
> the file, that GLB and the video slate offset — the persisted splat edits, USD override and
> camera presentation are replayed by the viewer as soon as the payload carries them.

### Video source, watermark, downloads

- **Video source.** When the studio has enabled **client derivatives**, the client is served the
  derivative — which carries a 3-second **slate** identifying studio, project, shot, version,
  artist, file and date. Comment timestamps are offset automatically so they always refer to the
  media itself, slate excluded, both when writing and when seeking. Without a derivative, the
  client gets the same file the studio holds (the proxy when the original was deleted after
  transcoding, the original otherwise).
- **Watermark.** A discreet overlay — recipient label, studio name, today's date — is drawn over
  the **viewer**, not over the grid thumbnails. It is **on by default** for shares, at an opacity
  of `0.08` that the studio can tune between `0.02` and `0.4`.
- **Downloads.** There is no download route and no download button, and the video element is set
  to `nodownload`. The presigned URL is still handed to the browser, so this is a courtesy, not a
  DRM guarantee.

### Comments, and what the permission changes

| | `VIEW` | `COMMENT` |
|---|---|---|
| Play a video, view an image, inspect a 3D model or a splat | yes | yes |
| Read top-level comments flagged **visible to the client** | yes | yes |
| Read replies | never | never |
| Read internal notes | never — the flag is off by default, so nothing leaks by accident | never |
| Write a comment | refused with a `403` | yes, signed with a free-form name remembered in their browser |

A note written by a client is not a second-class citizen: it lands in the same thread the team
uses, flagged visible to the client, pushed live into the project room, sent to the media's
watchers and to whoever created the link, published to the outgoing webhooks and to the v1 event
journal, and pushed to ShotGrid as a note like any other. On a video it carries the timestamp of
the frame on screen; on a 3D model or a splat it can carry the camera.

Use *Show to the client* on an internal comment to publish it outward. See
[Annotations & comments](annotations-and-comments.md).

## Auditing

Every step is recorded in the audit log (*Admin → Maintenance → Audit*):

| Action | When | Metadata |
|--------|------|----------|
| `SHARE_CREATE` | A link is created | permission, label, whether it has a password, view limit, expiry, scope and its target, size of the selection |
| `SHARE_EMAIL` | The link is mailed | the link, how many recipients were addressed, how many messages actually went out |
| `SHARE_VIEW` | A view is consumed | the link, its label, the visitor's IP, and whether it came from a password unlock |
| `SHARE_UNLOCK_FAIL` | A wrong password | the link and the IP |
| `SHARE_REVOKE` | A link is revoked | the link, and the account that revoked it |

Public events carry the **IP and the link id, never a user id** — there is no user. Media access
through a share is recorded separately, per media, so you can tell which shot was actually
opened.

Two rate limits protect the public routes: **10 password attempts per 15 minutes** per IP and
per link, on top of a global **300 requests per 15 minutes** on `/api/client` and `/api/share`.

## Use cases

### Sending tonight's cut to a client who has no account

1. Build the dailies playlist as usual — see
   [Playlists & live review](playlists-and-live-review.md).
2. Project → **Shares** → **New link**: recipient `Client — Acme`, *What the link opens* → **A
   single playlist** → tonight's playlist, permission **Read + comments**, expiry **7 days**,
   view limit **20**.
3. Right-click the new row → **Send by email…**, one address, a line of note. The message says
   which playlist it opens and when it dies.
4. Watch the counter over the week. `6 / 20` with a recent last-viewed date means it is being
   read.

Adding a shot to that playlist afterwards adds it to what the client sees, the moment its media
is published. Removing an item takes it away. The link follows the playlist — that is the point
of a `PLAYLIST` scope.

### Getting one shot approved without opening the film

Create a `VERSION`-scoped link, or a `MEDIA` link with the two takes you want compared. Both are
permanent decisions of that link: the scope cannot be edited afterwards. If the review moves on,
revoke and create a new one — links are cheap, and the audit log keeps the trace.

### A link that must not travel further

Add a **password**, and send it on a different channel from the link. The padlock in the list
reminds you which links carry one.

Ten wrong attempts within a quarter of an hour lock that IP out of that link, and every failure
is in the audit log. Combine it with a **view limit** of 1 or 2 if the link is meant for exactly
one person.

### The client asks to look at a 3D model or a splat

Send them a `VERSION`- or `MEDIA`-scoped link. They get the same viewer the studio uses, in
read-only form, watermarked like everything else. There is nothing else to arrange — no export,
no live session, no temporary account.

If you want to *talk* over it rather than let them look alone, that is a
[live review session](playlists-and-live-review.md#live-review-session), which does need an
account.

### Cutting access after delivery

Revoke the link in the **Shares** tab. It stops working immediately, including for sessions
already open, and answers the same way an unknown token does. The audit entry records who
revoked it and when.

If you only want to stop *new* viewers while letting the current review finish, let the **view
limit** do it: open sessions survive, new ones are refused.

## Troubleshooting

**The client sees an empty grid.** Either nothing in the scope is published yet — the filter
comes before the scope — or the scope's target was deleted, in which case the list shows the
scope badge as *Restricted*.

**The client sees more than expected.** The link is `PROJECT`-scoped. There is no way to narrow
an existing link; revoke it and create a scoped one.

**The counter climbs faster than the number of people.** One session per browser tab, and a
session lasts 24 hours. A client who reopens the link tomorrow morning spends another view.

**A comment from the client never arrived.** The link is `VIEW`-only, and the write was refused
with a `403`. Check the permission badge on the row.

**Nothing happens when I send the e-mail.** `APP_URL` or SMTP is not configured; the error names
which. Both are studio-level settings.

## Related pages

- [Secure distribution (admin)](../admin-guide/secure-distribution.md) — burn-ins, client
  derivatives, slate and watermark settings
- [Annotations & comments](annotations-and-comments.md) — the client-visible flag
- [Upload & publishing](upload-and-publishing.md) — what "published" means
- [Playlists & live review](playlists-and-live-review.md) — the playlist a link can be scoped to
- [Users & roles (admin)](../admin-guide/users-and-roles.md)
