# Playlists & live review sessions (dailies)

> Updated: 2026-07-19

ReView supports the classic **dailies** workflow: build a playlist of versions
across shots, play it end to end, and hold a **synchronized live session** where
one pilot drives playback for everyone in the room.

## Playlists

A playlist belongs to a **project** and contains **versions** (not media files),
in a custom order, freely mixed across shots and assets.

### Creating and filling a playlist

- **From the Reviews page** (main path): select one or more media (checkboxes,
  Shift-click for ranges), then right-click a selected card → *Ajouter à la
  playlist…* — or use the same action in the floating selection bar. Pick an
  existing playlist of the project or type a name to create one on the fly.
  Each media resolves to its version; duplicates are skipped automatically.
  The selection must belong to a single project.
- **From a version card** (task or asset page): right-click → *Ajouter à la
  playlist…* adds that version directly.
- **From an open review** (video/image): right-click the viewer → *Ajouter à la
  playlist…* adds the current media's version.
- **From the project page**: the *Playlists* tab also offers a
  *Nouvelle playlist* button for an empty playlist.

Writers are `ADMIN`, `SUPERVISOR` and `ARTIST`; a playlist can be modified or
deleted by **its creator or any supervisor/admin**. `CLIENT` accounts read only.

### Managing a playlist (project page → Playlists tab)

- Click a playlist to unfold its ordered items (thumbnail, shot/task location,
  version name, current review decision badge).
- **Right-click the playlist**: *Lire la playlist* (opens the first playable
  item), *Renommer…*, *Supprimer…* (references only — versions are untouched).
- **Right-click an item**: *Ouvrir en review*, *Monter*, *Descendre*,
  *Retirer de la playlist*.
- Item media follow the usual draft visibility rule: an unpublished media is
  only playable by its uploader.

### Chained playback

Opening an item adds `?playlist=<id>` to the review URL. The review header then
shows a **playlist navigator**: playlist name, position (n/N) and
previous/next buttons that jump to the closest playable neighbouring version.
Versions whose media you cannot see are skipped.

## Live review session

Any review can become a **synchronized room** — ideal for dailies with the
playlist navigator, but it also works on a single media.

- The **antenna button** in the review header joins (or starts) the session for
  the current playlist (`?playlist=` present) or media. The first participant
  becomes the **pilot**; the URL gains `?live=1` (shareable — anyone opening it
  joins the same room, subject to project access).
- The **driver** (see roles below) drives everyone: current media (navigation
  follows automatically, including playlist prev/next), video playhead and
  play/pause, **A/B comparison including the side-by-side / wipe mode and the
  wipe bar position and angle**, the **3D/splat camera including splat
  depth-of-field** (followed continuously, including while the driver holds a
  right-click fly/look-around drag), and the **image zoom/pan**. The broadcast
  rate is configurable per media type in *Admin → Réglages* (`Live : cadence …`,
  1–30 Hz — raise the 3D/splat rates for smoother camera following).
- **Roles**: the first participant is the **pilot** (crown). The pilot manages
  roles by right-clicking a participant's avatar, or by **right-clicking the
  LIVE chip** (submenus *Donner la main* / *Co-pilotes* listing every
  participant): *Donner la main* is a full pilot handoff, *Nommer co-pilote*
  grants the lightning icon. Among pilot and co-pilots, the **driver** —
  highlighted with a ring — is simply the last one who interacted (play/pause/
  seek, playlist navigation, camera click, image zoom/pan, wipe drag): the
  first to act takes the wheel.
- **Refreshing keeps your role**: a page reload (F5) or a brief disconnect
  keeps the pilot/co-pilot roles — the server waits a grace period (10 s)
  before actually removing a disconnected participant.
- If the pilot leaves for good, the first co-pilot (else the longest-present
  participant) inherits the session. Leaving is a click on the LIVE chip;
  closing the tab works too (after the grace period).
- **Autoplay**: if a viewer joined without interacting with the page first,
  the browser may block sound — playback then starts muted and a *Son* button
  appears on the LIVE chip to enable audio.
- **Decisions during the session**: the review-decision button stays available,
  so supervisors can dispatch approvals/retakes as the room reviews each
  version (see [Review decisions & approvals](review-approvals.md)).

### Seeing that a session is running

Ongoing sessions are surfaced wherever the content appears (refreshed in real
time over the project socket room):

- **Review header**: if a session already runs on the current media/playlist,
  the antenna button becomes a pulsing **LIVE · n** badge (tooltip shows the
  pilot) — one click joins it.
- **Version cards** (task and asset pages) show the same clickable badge when
  one of their media hosts a session.
- **Playlists tab**: a playlist with a live session shows the badge; clicking
  it opens the first playable item and joins the room.
- **Dailies notification**: when someone starts a live session **on a
  playlist**, every project member receives an in-app notification
  ("X a démarré une review live sur la playlist « … »") — clicking it joins
  the session directly.

Access control is enforced server-side: joining a room re-checks project
membership, and only sync messages from the pilot/co-pilots are relayed.
`GET /api/live/sessions?projectId=` returns the project's ongoing sessions
(key, media/playlist/version ids, participant count, pilot).
