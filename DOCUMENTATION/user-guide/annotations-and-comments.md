# Annotations & comments

> Updated: 2026-08-21

Every review — video, image, 3D, splat — shares the same commenting system: threads,
states, mentions, reactions, attachments, voice notes, deep links and kanban hand-off. What
changes with the media type is what a comment can *carry*: a drawing on a frame, a pin on a
surface, a camera move, a scene proposal.

## The comments panel

- The panel sits beside the viewer and is toggled from the review header. It can be resized,
  and it stays visible in the unified fullscreen so you can keep annotating. Theatre mode
  hides it on purpose.
- On video, a comment is **anchored to the current frame**: clicking its card later jumps the
  player back to that exact frame, and its author's avatar marks the position on the
  timeline. Timeline markers appear in the thread as clickable separators, splitting it into
  sections.
- `Ctrl+Enter` (or `⌘+Enter`) sends. `Enter` inserts a newline — a note about a shot is
  rarely one line.
- **Replies** nest under a root comment. A reply is plain: no send shortcut, no microphone,
  no drawing of its own.
- **Editing** is limited to the author, and an edited comment carries a small *modified*
  badge. Deleting is open to the author and to any `SUPERVISOR` or `ADMIN`.

## Comment states

A comment carries one of five states, each with its own colour on the card:

| State | Meaning |
|---|---|
| **Open** | nothing has been decided yet (the default) |
| **Working on it** | someone has taken it |
| **Question** | the note is not understood, an answer is expected |
| **Won't fix** | knowingly left as is |
| **Resolved** | done |

The button at the top right of a card toggles between **Resolved** and **Open** — that one
gesture covers most of the traffic. The three other states are a **right-click** away: five
buttons per card would not read. Resolving a root comment is open to its author and to
`SUPERVISOR` / `ADMIN`.

Two filters exist, and they are not the same one:

- the **panel header** shows `N open / total` and filters *All / Open / Resolved*. It reads
  the resolved flag, so a *Won't fix* comment still counts as open there;
- the **thread** carries a row of state pills with their counts, shown as soon as there is
  more than one comment. That row is the one that separates *Question* from *Working on it*.

Cards in a closed state (*Resolved*, *Won't fix*) are dimmed, and the badge tooltip says who
closed it and when.

## Mentions

- Type `@` in the composer or in a reply to autocomplete **project members** — up to six
  suggestions, matched on the handle or on the display name.
- Navigate with `↑` and `↓`, insert with `Enter` or `Tab`, dismiss with `Esc`.
- A handle is the member's username, or the local part of their email when no username is
  set.
- Mentioned members get a targeted notification that opens the review, and the mention is
  highlighted in the thread. You are never notified for mentioning yourself.

## Attachments & voice notes

- The paperclip accepts **images** (PNG, JPEG, WebP, GIF), **PDF**, **ZIP** and **plain
  text**, and pasted images are converted to PNG when the clipboard offers an exotic format.
  **Eight attachments per comment** is the ceiling, enforced on both sides.
- Images are shown as thumbnails — two of them, then a `+N` tile opening a lightbox carousel.
  Everything else is a downloadable chip.
- The **microphone** in the main composer records a voice note: WebM/Opus where the browser
  supports it, the browser's own format otherwise, with the file extension following. It is
  attached like any other file and plays inline in the thread. Replies have no microphone.
- `Ctrl+V` in the composer attaches the clipboard image to the comment. The same paste with
  the focus in an **image viewer** pins it as a reference on the picture instead — see
  [Image review](review-image.md).

## Reactions

Eight emoji are offered on any comment (👍 ❤️ 😂 🎉 👀 🔥 ✅ ❓), one per user and per emoji,
toggled by clicking. They group into chips with a count, and your own are outlined.

## Drafts

The composer text and any in-progress 2D drawing are saved in your browser, per media.
Leaving the review or reloading the page keeps them; they are cleared only when the comment
is **successfully sent**, so a failed send never loses your note. Attached files, 3D pins,
camera animations and scene proposals are *not* part of the draft — re-attach them if you
reload.

## Annotations

Enter the **Annotate** mode from the *Annotate* button of the composer, from the viewer's
right-click menu on video and image, or simply by pressing a drawing tool letter. The rail
then fills with the drawing tools and the options bar carries the ink, thickness and opacity
of the armed one.

| Tool | Key | Notes |
|---|---|---|
| Freehand | `D` | |
| Rectangle | `R` | |
| Ellipse | `E` | |
| Arrow | `A` | |
| Polygon | `G` | one click per vertex, **double-click to close**; fewer than three vertices is discarded |
| Text | `T` | click to place, type, then `Enter` or click away to commit — `Esc` cancels, empty text is dropped |
| Move a shape | `M` | pick up a shape already drawn |
| Eraser | `X` | click, or drag over several shapes |

- Five ink swatches are offered directly, plus a free colour picker that opens outside the
  page so it never covers the media. Thickness runs from 1 to 24 px, opacity from 10 to
  100 %.
- Undo, redo and *clear all* sit at the right of the options bar, and the row tells you how
  many shapes are currently attached to the comment.
- Drawings are an overlay: they leave with the comment you send, and the composer is emptied.
- You can draw **half an image beyond each edge** — an arrow pointing in from outside the
  frame is a legitimate note. The first time a stroke goes past the delivery guide, a toast
  says so.
- **`Esc`**, or the pill at the top of the viewer, hides the annotation of the comment
  currently displayed.

**Where a drawing is anchored** depends on the media:

- **Video and image** — to the media itself. A stroke stays on its pixel through window
  resizes, fullscreen, and (on images) any amount of zoom and pan.
- **3D and splat** — to the **delivery frame**, the letterbox guide that materialises the
  shot's aspect ratio, so a drawing made on one screen lines up on every other.

On video, moving the playhead by hand hides the displayed annotation and deselects its
comment: the drawing is only aligned with its own frame. On 3D and splat, moving the camera
does the same — except that a comment's **scene proposal** stays applied so you can inspect
it from another angle.

## What a comment carries on 3D and splat media

Beyond text, a spatial comment can bundle:

- a **pin** placed on the surface (the `I` tool), which brings everyone back to the point;
- **3D brush strokes** painted on the surface (splat, the `P` tool), stored in object space;
- the **camera animation** you built, so a note can be a move rather than a sentence;
- a **scene proposal** — the prims you moved, hid or re-varianted — replayed only while the
  comment is selected, which is how you suggest a change to a published asset without
  touching it.

A comment needs text *or* one of these payloads to be sent; a drawing alone is enough.

## Deep links

- Viewer right-click on a video → **Copy the link to this frame** produces a URL carrying
  `?frame=N`; opening it seeks the review straight there, waiting for the player to be ready
  if needed.
- Comment card right-click → **Copy the link to the comment** produces `?comment=ID`;
  opening it selects the comment — seek, annotation and camera restored — and scrolls to its
  card. A link to a reply selects its root comment.
- A URL carrying both is resolved on the comment.

## Comment → kanban task

`SUPERVISOR` and `ADMIN` can right-click a comment card → **Create a kanban task**.

- The task is attached to the shot or the asset carrying the media's version. A media
  attached to neither cannot produce a task.
- Its name is taken from the comment text, stripped of formatting and truncated at eighty
  characters; its type is *Other*; it inherits the comment's assignee when one was set.
- The task page shows an **original comment** chip linking back to the review at the exact
  frame and annotation, and a toast offers to open the new task straight away.

## Watching (notification subscriptions)

- Right-click a **shot card**, an **asset card** or a **version card** → *Watch* / *Stop
  watching*.
- Watchers are notified of new **root** comments, media **publications** and **review
  decisions** on the watched item and on anything below it in the chain — watching a shot
  covers its versions and their media. Replies do not notify watchers.
- The person who acted is always excluded, and so is anyone already notified by an
  `@`-mention. On a review decision, the version author is excluded too — they get their own
  notification.

## Roles & client visibility

- All project members can comment. `CLIENT` accounts stay in the read-only Watch/Explore
  mode of the viewer, with no editing tool.
- A comment is **not** visible on a share link unless a manager makes it so: the default is
  hidden. `SUPERVISOR` and `ADMIN` toggle *Show to the client* from the comment's right-click
  menu.
- **Share-link guests** see only root comments explicitly marked visible. Whether they can
  answer at all depends on the link's permission: a `VIEW` link is read-only, a `COMMENT`
  link lets them post a named comment with an optional timecode. Guests cannot draw, attach
  files, or reply in a thread.

## Use cases

### Turning a dailies note into work

You circle the flicker, write "unstable roto on the left arm", and send. The next morning
the coordinator right-clicks that card and creates a kanban task: it lands on the shot,
named after the note, and the artist opens it from the board. The task keeps a chip back to
the review at that exact frame — nobody has to re-find the moment being discussed.

### A note that is a question, not a correction

Half the notes in a review are "is this intentional?". Set that comment to **Question** from
the right-click menu instead of leaving it Open: the thread's state pills then show at a
glance that three items are waiting on an answer and eleven on a fix. When the answer is
"yes, keep it", switch it to **Won't fix** rather than resolving it — the history says the
decision was taken, not that the work was done.

### Bringing the right person in

The comp note actually concerns lighting. Type `@` and the first letters of the lead's
username in a reply: they get a notification that opens the review straight on the thread.
No email, no copy-pasted link, and nobody else is disturbed.

### Talking through a note that takes a paragraph

Some notes are faster spoken. Hit the microphone in the composer, describe the fix while
scrubbing, stop. The voice note is attached at the current frame and plays inline in the
thread, next to the drawing that goes with it.

### Suggesting a change on a published asset

The asset is published, so its scene is frozen. Move the prim anyway, and send a comment:
the delta rides along with your note and is replayed only when someone selects it. The
published scene is untouched, and the supervisor can see the proposal from any angle before
deciding to ask for a new version.

### Keeping the client out of the internal thread

Internal notes are hidden from share links by default, so a review can be brutal without
consequence. When one note *should* reach the client, a supervisor marks it *Show to the
client*; on a `COMMENT` link the client answers under it, with their name attached.

## Troubleshooting

**`Ctrl+Enter` does nothing in a reply.** Only the main composer has the send shortcut; use
the button.

**"8 attachments max per comment".** Split the note in two, or zip the files. There is no
size limit, but a very large attachment is still a very large upload.

**My draft came back but the attached files did not.** Only the text and the 2D drawing are
saved locally. Files, pins, camera animations and scene proposals are not.

**The `Open` counter says 4 but I only see 3 open notes.** The header counter and the header
filter read the resolved flag, so *Won't fix* comments count as open. The per-state pills in
the thread give the exact breakdown.

**The client cannot see my comment.** Comments are hidden from share links by default. A
supervisor has to mark each one *Show to the client*.

**A guest says the link is read-only.** The share was created with `VIEW` permission. Issue a
`COMMENT` link — see [Sharing](sharing.md).

**"Create a kanban task" is missing, or fails.** It is limited to `SUPERVISOR` and `ADMIN`,
and the media's version must hang off a shot or an asset.

**My drawing landed outside the frame.** On 3D and splat, strokes are anchored to the
delivery guide and you can draw beyond it deliberately; the toast that appears the first
time is a warning, not an error. If it was unintentional, `Ctrl+Z` in the options bar or the
eraser will do.

**Nothing happens when I press a tool letter.** The caret is probably still in the composer —
no shortcut fires while you are typing. Click into the viewer first.

## Related pages

- [The review workspace](review-workspace.md)
- [Video review](review-video.md) · [Image review](review-image.md) ·
  [3D review](review-3d.md) · [Splat review](review-splat.md)
- [Kanban & tasks](kanban-and-tasks.md) — tasks created from comments
- [Review decisions & approvals](review-approvals.md) — decisions notify watchers
- [Sharing](sharing.md) — client access permissions
