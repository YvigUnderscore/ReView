# The client portal

*What someone outside the studio sees when they open a share link: a home page, four tabs, and the same drawing tools your artists use.*

> Updated: 2026-09-17

A share link opens a page that belongs to your studio: your logo, your project, and nothing
else. There is no sign-in, no application to navigate, and no way out of what the link
opens. This page describes that portal from the client's side. Creating, scoping, expiring
and revoking the links themselves stays in [Sharing with clients](sharing.md).

## Landing on the link

The link opens on a **home page**, not on a wall of thumbnails. It carries, in this order:

- **a one-line inventory** — *2 sequences · 7 shots · 12 assets · 16 media* — so the reader
  knows whether they were sent one shot or a whole episode before clicking anything;
- **the playlists the link opens**, as cards showing how many items each holds;
- **the latest published media**, twelve tiles, newest first, with *View all* next to them.

Each tile names the file, and under it the task and version it came from — *Compositing ·
V03*. A grid of three files called `comp.mov` does not say which one is the latest; this
does.

## Finding a shot

Under the home page sit four tabs.

| Tab | What it lists |
|-----|---------------|
| Review | Everything the link opens, flat, newest first. The view that cannot mislead |
| Sequences | One card per sequence → its shots → their media |
| Shots | Every shot the link reaches, flat |
| Assets | One card per asset, with the studio's own type label when it has one |

**A tab with nothing in it is not shown.** A link that only opens one asset offers *Home*,
*Review* and *Assets* — naming "Sequences" would be telling the client something about the
show that the link was not meant to share.

Where you are lives in the address bar (`?tab=shots`, `?shot=42`, `?m=128`). The browser's
Back button works, and a client can send a colleague the link to the exact shot they are
talking about — without widening anything, since it is the same token and the same scope.

![The studio tree on the left holds published and unpublished versions, a hidden sequence
and two playlists. The link's scope keeps only what is published, not hidden and inside the
scope, so the guest portal on the right shows a home with one playlist and the latest media,
and only the tabs that have something in
them.](../assets/user-guide/client-portal-scope.svg)

The pruning is not cosmetic. A sequence you hid takes its shots with it, a version still in
draft never appears, and a playlist is named only if it actually opens something — a
playlist's name (*"Retake — client round 3"*) is production information in its own right.

> [!NOTE]
> The portal serves at most 200 media per page load. Past that it says so, in as many words,
> and the counts on the cards describe what was served rather than the whole project. The
> answer to a link that shows too much is to narrow the link, not to page a catalogue in
> front of a client. See [Creating a link](sharing.md#creating-a-link).

## Watching, and drawing on it

Opening a tile gives the viewer for that kind of media — the studio's own, in read-only
form. What each of the four gives the client is listed in
[What the client sees](sharing.md#what-the-client-sees).

On a link with the **Read + comments** permission, a *Annotate the media* button sits above
the viewer. Pressing it opens the same tool bar your artists use:

| | |
|---|---|
| `D` Freehand · `R` Rectangle · `E` Ellipse | `A` Arrow · `P` Polygon · `T` Text |
| `S` Move a shape · `X` Eraser | Ink, thickness, undo, redo, clear all |

The drawing is attached to the comment, not to the media: it travels with the note, and a
note with a drawing is marked in the thread so the client knows a click will put the shape
back on the image. On a video it is anchored to **the frame it was made on** — the thread
shows both the timecode and the frame number in your own numbering, `00:04 · 1097`, which is
the number the artist will look for. Clicking a note pauses on that frame and redraws the
shape; `Esc`, or the *Hide the annotation* pill, clears it.

Drawing works on all four kinds of media. On a 3D model or a splat the overlay is anchored to
the delivery frame, so the shape stays where it was put whatever the size of the reader's
screen.

A note is enough on its own: a drawing with no text is a valid comment.

## What the client's note becomes

Nothing about a client note is second class. It lands in the same thread the team uses, is
flagged visible to the client, is pushed live into the project room, notifies the media's
watchers and whoever created the link, goes out to the webhooks and the v1 event journal, and
is pushed to ShotGrid as a note like any other. The drawing is stored in the same format the
internal review reads, so an artist opening the thread lands on the right frame with the
shape in the right place.

See [Who sees what: clients, guests and share
links](annotations-and-comments.md#who-sees-what-clients-guests-and-share-links) for the full
audience table.

## What a guest still may not do

| | `VIEW` | `COMMENT` |
|---|---|---|
| Browse the home page and the tabs | yes | yes |
| Play, inspect, orbit, zoom | yes | yes |
| Read comments flagged visible to the client | yes | yes |
| Write a comment | refused with a `403` | yes |
| Draw on a media | no tool is offered | yes |
| Read replies, or any internal note | never | never |
| Change the staging, the camera, the splat, the scene | never | never |
| Download | there is no download route | there is no download route |

A guest's drawing is deliberately narrower than a reviewer's: a client draws and points, but
cannot attach a 3D scene proposal, a camera animation or 3D brush strokes. Those are
authoring gestures that are replayed for everyone who opens the media, and a share link is
not where they belong.

Write access from a link is rate limited, per link and per link-and-address. A client who
hits the ceiling is told to try again later; the link is not revoked.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| The client sees an empty section | The tab was reached by a copied address pointing at an entity outside the scope | Send the bare link; it opens the home page |
| A tab the client expected is missing | Nothing inside the link's scope belongs to that level | Widen the scope, or publish the version |
| No *Annotate the media* button | The link is `VIEW` | Issue a `COMMENT` link — the permission cannot be changed on an existing one |
| The frame number does not match the artist's | The media has no frame rate recorded, so the viewer falls back to 24 fps | Correct the frame rate in the transport, or reprocess the media |
| A drawing looks offset on a 3D model | The media has no camera presentation, so the delivery frame defaults to 16:9 | Stage and publish the presentation from the internal review |

## Related pages

- [Sharing with clients](sharing.md) — creating, scoping, expiring and revoking links
- [Annotations & comments](annotations-and-comments.md) — the thread on the studio side
- [Secure distribution](../admin-guide/secure-distribution.md) — watermark, burn-ins, audit
- [Review workspace](review-workspace.md) — the tools the portal borrows
