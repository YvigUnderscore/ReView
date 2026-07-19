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
  play/pause, **A/B comparison**, the **3D/splat camera including splat
  depth-of-field**, and the **image zoom/pan**. The broadcast rate is
  configurable per media type in *Admin → Réglages* (`Live : cadence …`,
  1–30 Hz — raise the 3D/splat rates for smoother camera following).
- **Roles**: the first participant is the **pilot** (crown). Right-clicking a
  participant's avatar, the pilot can *Donner la main* (full pilot handoff) or
  *Nommer co-pilote* (lightning icon). Among pilot and co-pilots, the
  **driver** — highlighted with a ring — is simply the last one who interacted
  (play/pause/seek, playlist navigation, camera click, image zoom/pan): the
  first to act takes the wheel.
- If the pilot leaves, the first co-pilot (else the longest-present
  participant) inherits the session. Leaving is a click on the LIVE chip;
  closing the tab works too.
- **Autoplay**: if a viewer joined without interacting with the page first,
  the browser may block sound — playback then starts muted and a *Son* button
  appears on the LIVE chip to enable audio.
- **Decisions during the session**: the review-decision button stays available,
  so supervisors can dispatch approvals/retakes as the room reviews each
  version (see [Review decisions & approvals](review-approvals.md)).

Access control is enforced server-side: joining a room re-checks project
membership, and only sync messages from the pilot/co-pilots are relayed.
