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
- The **pilot** drives everyone: current media (navigation follows
  automatically, including playlist prev/next), video playhead and play/pause,
  and the 3D/splat camera, broadcast about twice per second.
- **Participants** appear as avatars next to the LIVE chip; the pilot wears a
  crown. The pilot can **hand over control** by clicking another participant's
  avatar.
- If the pilot leaves, the longest-present participant inherits the controls.
  Leaving is a click on the LIVE chip; closing the tab works too.
- **Decisions during the session**: the review-decision button stays available,
  so supervisors can dispatch approvals/retakes as the room reviews each
  version (see [Review decisions & approvals](review-approvals.md)).

Access control is enforced server-side: joining a room re-checks project
membership, and only the pilot's sync messages are relayed.
