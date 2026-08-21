# Playlists & live review sessions (dailies)

> Updated: 2026-08-21

ReView supports the classic **dailies** workflow: build a playlist of versions across
shots, play it end to end, and hold a **synchronized live session** where one pilot
drives playback for everyone in the room.

## Playlists

A playlist belongs to a **project** and contains **versions** — not media files — in a
custom order, freely mixed across shots and assets. Names are unique inside a project; a
duplicate name is refused with a `409`.

Writers are `ADMIN`, `SUPERVISOR` and `ARTIST`. Renaming, reordering, adding, removing
and deleting additionally require being **the creator or a supervisor/admin**. `CLIENT`
accounts read only.

### Filling a playlist

| From | Gesture | What is added |
|------|---------|---------------|
| **Reviews** page | Tick cards (Shift-click for a range), then right-click a selected card → *Add to playlist…*, or the same action in the selection bar | The version behind each selected media |
| **Version card** (task or asset page) | Right-click → *Add to playlist…* | That version |
| **Open review** | Right-click the viewer → *Add to playlist…* | The current media's version |
| **Shot page** | Right-click → *Add to a playlist* → a playlist | The shot's latest version, at the furthest stage it has reached |
| **Sequence page** | Right-click → *Add to a playlist* → a playlist | See the note below |
| **Playlist page** | The `+` on a catalogue row, or tick several and add them at once | The chosen versions |
| **Project → Playlists** tab | *New playlist* | An empty playlist |

The first three open a **dialog**: pick an existing playlist of the project, or type a
name and create it on the fly. The selection has to belong to a single project — a
playlist is scoped to one, and a mixed selection is refused with a clear message.

The last two use a **submenu** listing the project's playlists. That submenu is absent
when the project has no playlist yet — create the first one from the Playlists tab or
from the dialog.

Media are resolved to their version server-side, and duplicates are skipped: adding
returns *n added, n skipped*.

> **What a sequence-level add really adds.** It fetches the sequence's candidate list
> with *latest only* on, capped at 300. "Latest only" keeps the **most recent version of
> each task**, so a shot carrying animation, lighting and compositing tasks contributes
> **three** versions, not one. Versions attached directly to an asset are always kept.
> There is no published-only filter at that step, so review the result on the playlist
> page before the screening.

### The playlist page

Clicking a playlist opens `/playlists/:id`, in two panels.

**Left — the project catalogue** (shown only to people who can edit the playlist): every
version of the project, with a free-text search, a sequence filter, a department filter
and a **Latest only** switch, on by default. Dailies show the current state of the work,
not the history of each task. Results are capped at **100**; narrow the search rather
than scrolling. What the playlist already holds is marked, not offered twice. Add one
with the `+`, or tick several and add them in one go.

**Right — the playlist itself**: numbered items with thumbnail, location
(`SQ010 · SH020 › comp`), version name and review decision. Right-click an item to open
it in review, **move it up**, **move it down**, or remove it. Reordering is
arrow-based — there is no drag-and-drop here.

Renaming happens inline in the header (pencil icon; Escape cancels, blur saves).
**Play** jumps to the first item that has a playable media. Deleting a playlist removes
references only — versions are untouched.

Item media follow the usual draft visibility rule: an unpublished media is only playable
by the person who uploaded it.

### Chained playback

Opening an item adds `?playlist=<id>` to the review URL. The review header then shows a
**playlist navigator**: playlist name, position (n/N) and previous/next buttons that jump
to the closest playable neighbouring version. Versions whose media you cannot see are
skipped. There is **no keyboard shortcut** for playlist navigation — the buttons are the
only way.

## Live review session

Any review can become a **synchronized room** — built for dailies with the playlist
navigator, but it works on a single media too.

- The **antenna button** in the review header joins (or starts) the session for the
  current playlist (`?playlist=` present) or media. The session key is literally
  `playlist:<id>` or `media:<id>`. The first participant becomes the **pilot**; the URL
  gains `?live=1` and is shareable — anyone opening it joins the same room, subject to
  project access, which the server re-checks at join.
- **What the driver broadcasts**: the current media (navigation follows automatically,
  including playlist prev/next), the video playhead and play/pause, the A/B comparison
  including side-by-side, wipe and diff modes plus the wipe bar position and angle, the
  3D/splat camera (followed continuously, including while the driver holds a right-click
  fly/look-around drag), and the image zoom/pan.
- **Broadcast rate** is configurable per media type in *Admin → Settings*, clamped
  between 1 and 30 Hz. Defaults: **2 Hz video**, **4 Hz image**, **10 Hz 3D**,
  **10 Hz splat**. Raise the 3D and splat rates for smoother camera following.
- **Roles.** The first participant is the **pilot** (crown). The pilot manages roles by
  right-clicking a participant's avatar, or by right-clicking the **LIVE chip** — two
  submenus, one to hand over the pilot seat, one to name co-pilots. Handing over is a
  full transfer: the new pilot leaves the co-pilot list and becomes the driver.
  Co-pilots get the lightning icon.
- **The driver** — highlighted with a ring — is simply the last pilot or co-pilot who
  interacted (play/pause, seek, playlist navigation, camera click, image zoom/pan, wipe
  drag). The first to act takes the wheel. Sync messages from anyone who is not the
  current driver are dropped by the server; messages from someone who is neither pilot
  nor co-pilot are never relayed at all.
- **Refreshing keeps your role.** A page reload or a brief disconnect keeps pilot and
  co-pilot roles: the server waits a **10-second grace period** before removing a
  disconnected participant. Navigating between playlist items inside the app is also
  covered, by a shorter client-side delay.
- If the pilot leaves for good, the **first co-pilot** inherits — failing that, the
  longest-present participant. The session disappears when the last person leaves.
  Leaving is a click on the LIVE chip; closing the tab works too, after the grace period.
- **Autoplay.** If a viewer joined without interacting with the page first, the browser
  may block sound: playback starts muted and a sound button appears on the LIVE chip.
- **Decisions during the session.** The review-decision button stays available, so
  supervisors can dispatch approvals and retakes as the room reviews each version — see
  [Review decisions & approvals](review-approvals.md).

### Seeing that a session is running

Ongoing sessions are surfaced wherever the content appears, refreshed in real time over
the project socket room:

- **Review header** — if a session already runs on the current media or playlist, the
  antenna becomes a pulsing **LIVE · n** badge whose tooltip names the pilot. One click
  joins.
- **Version cards** on task and asset pages show the same clickable badge when one of
  their media hosts a session.
- **Playlists tab** — a playlist with a live session shows the badge; clicking it opens
  the first playable item and joins the room.
- **Notification** — when someone starts a live session **on a playlist**, every other
  project member gets an in-app notification that opens the room directly. A session
  started on a single media sends nothing: it is usually a one-to-one look, not a
  screening.

`GET /api/live/sessions?projectId=` returns the project's ongoing sessions: key,
project id, media / playlist / version ids, participant count and pilot. The version id
is present only for sessions started on a media — a playlist session does not carry one.

## Use cases

### Building tonight's dailies in three minutes

Eighteen shots went out today and the screening is at 18:00.

1. Open the **Reviews** page, filter **project** and set the status filter to
   **Published**. Sort is newest first by default.
2. Tick the first card, **Shift-click** the last one of today's batch.
3. Right-click a selected card → *Add to playlist…* → type `2026-08-21 dailies` →
   **Create**. Duplicates are skipped, so a second pass costs nothing.
4. Open the playlist and reorder with the right-click *move up / move down* so the
   sequence reads in cut order.
5. Open the first item. The header shows `1/18` and the next button walks the list.

### Screening a whole sequence, whatever stage it is at

The supervisor wants to look at SQ040 end to end.

1. Open the sequence page, right-click → **Add to a playlist** → the review playlist.
2. Check the result: you got the latest version of **each task** of each shot, so a shot
   in compositing brings its animation and lighting versions too. Remove what you do not
   want to screen — that pass is quicker than adding shot by shot.

If you want the sequence as an edit rather than as a list, use its **cut** instead: it is
already ordered, already up to date, and it plays without interruption. See
[Auto-updating cut timelines](auto-cut-timelines.md).

### Running the room

Six people, one screen each, one conversation.

1. The supervisor opens the playlist item and clicks the **antenna**. They are pilot and
   driver; the URL now carries `?live=1`.
2. They paste the URL in the studio chat. Everyone who opens it lands on the same frame.
3. The supervisor right-clicks the LIVE chip → co-pilots → the lead compositor. The lead
   can now take the wheel simply by scrubbing — no handover ceremony.
4. On a splat or 3D shot, raise the broadcast rate for that media type in
   *Admin → Settings* beforehand: at 10 Hz the camera follows smoothly, at 2 Hz it
   stutters.
5. As each version is discussed, the supervisor issues the decision from the review
   header. The board and the artist's notifications update while the room moves on.
6. Someone's browser hiccups and they reload: they come back with the same role, in the
   same room, on the same frame.

### Reviewing without a room

A single media works too: click the antenna on any review. Nobody is notified — that is
deliberate — so send the `?live=1` link to the one person you want on the call.

## Related pages

- [Review workspace](review-workspace.md) — the review chrome, A/B and wipe
- [Review decisions & approvals](review-approvals.md)
- [Auto-updating cut timelines](auto-cut-timelines.md)
- [Navigation & search](navigation-and-search.md)
