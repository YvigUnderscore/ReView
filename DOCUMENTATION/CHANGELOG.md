# Changelog

Product release notes, newest first. Each `##` entry appears in the in-app **What's new**
panel. Keep entries short and user-facing (features and notable fixes, not internals).

## 2026-08-28 — Cards carry their name until they carry an image

- **A card with no image now shows its name.** Projects, episodes, sequences, shots and
  assets used to share one grey picture icon, repeated as many times as there were cards: a
  freshly imported production was a wall of identical tiles. The name is written across the
  tile instead, sized to fit, and compact rows show the part that actually identifies the
  element — its last number (`SH0120` → `0120`), or two initials when it has none.
- **The image arrives on its own.** As soon as a media is published under an element, its
  still replaces the name everywhere. Sequences and episodes never inherited anything before
  — their cards stayed empty however much work had been delivered — and the home page kept
  showing a project without its image. Both now follow the same rule as shots and assets.

## 2026-08-23 — The manual, rewritten and illustrated

- **Documentation you can read by chapter.** The `/docs` page no longer lists seventy pages
  in one column: sections fold and unfold, the one you are in opens by itself, and the
  chapters of the open page appear underneath — the one you are reading highlights as you
  scroll. Each page opens on a proper header (title, one-line summary, date in your own
  language) and closes on the previous and next page, so the manual can be read straight
  through.
- **144 diagrams.** Every page now carries one to three drawings: the shape of a show, the
  anatomy of the video player, what a share link exposes, how a job travels through the
  workers, which value actually reaches the mail relay. They follow the dark theme, and they
  are checked — a figure that does not scale, has no title for a screen reader, or is missing
  its dark variant fails the build.
- **Notes, warnings and cautions stand out.** The manual now uses coloured callouts for the
  thing you must know before acting, and the label is in your language.
- **Every page was re-read against the code.** Seventy pages, one by one: 191 statements that
  no longer matched the product were corrected, and what shipped without being written down —
  cursor pagination, EXR and DPX sequences, colour management on the pixels, the public API
  v1 and its Python client, the installer and its rollback, per-project webhooks, note export
  to CSV, EDL and OTIO — is documented.
- **The manual checks itself.** Broken internal links, dead anchors, missing images and
  malformed figures now fail the validation suite instead of waiting for a reader to click.

## 2026-08-21 — ShotGrid statuses, assignment by right-click, better emails

- **Statuses travel again, both ways.** Twenty confirmed defects were breaking the chain
  between ReView and ShotGrid: shot and sequence statuses never left ReView, concurrent
  syncs were silently dropped, an unknown status code *erased* the local status instead of
  keeping it, an unmapped version status wiped the review decision, and the
  “when both sides changed” setting arbitrated nothing — *ReView wins* and *manual*
  behaved exactly like *ShotGrid wins*. All fixed, with the reasons written down in
  [ShotGrid integration](admin-guide/shotgrid-integration.md).
- **Set a status from the right-click menu**, on a shot card, a sequence row, a kanban
  card, or the page of any of them. The current status is ticked, the vocabulary is your
  project's, and the badge moves before the server answers. Artists can set the status of
  a task assigned to them — the server always allowed it, the interface never offered it.
- **Assign a person or a department to an asset** the same way, and to a whole selection
  at once. Assigning an asset writes on its *tasks*, one per department — that is how the
  work is actually divided, and how ShotGrid models it too.
- **Imported media keep their ShotGrid name.** A media took the name of the attached file
  while its version carried the ShotGrid code: the two tools named the same thing
  differently, which made shots impossible to follow across windows. Media now carry the
  version code, keeping the real file extension; the delivered file name stays readable in
  the review technical sheet. Media imported earlier are renamed on the next sync.
- **Bring the ShotGrid crew into ReView in one click.** The Members tab of a linked project
  lists the people assigned to the project on the site, says who already has an account,
  and creates the missing ones — invitation sent, project membership included.
- **Emails are readable everywhere.** Every message now goes out as both HTML and plain
  text, opens with a preheader, and lays out on tables that Outlook renders predictably.
  Recurring emails carry a one-click unsubscribe; every message is marked as automatic, so
  out-of-office replies no longer answer the daily digest.

## 2026-08 — Interface overhaul: sequences, kanban at scale, playlists, production

- **Sequences have a page.** A sequence was an accordion row inside a tab, with its cut
  hidden behind a fold. It now opens on its own page: the cut first, then its shots as a
  grid with thumbnails and statuses. The whole-film cut moved to the top of the Sequences
  tab, next to the sequences it is made of.
- **One settings panel for sequences, shots and assets** (right-click, or the gear in the
  header): name, code, description, thumbnail, status, departments, frame range, and the
  resolution and rate overrides. Every entity can carry a thumbnail — the column existed,
  but nothing in the app could produce the key.
- **The kanban speaks your project's vocabulary.** Columns are built from the project's own
  statuses — a ShotGrid site commonly defines fifteen — grouped into five collapsible
  families on a scrollable band. Dropping a card no longer rewrites a fine-grained status
  into the first one that shares its legacy value.
- **Search and filters on Shots and Assets**, with the same criteria as the kanban and named
  presets saved per project and per account. Those lists had neither before.
- **Playlists are built from a catalogue.** A playlist page shows the project's versions on
  the left — search, sequence, department, latest-only — and the playlist on the right.
  “Add to a playlist” is now a right-click away, including on a whole sequence.
- **Production answers four questions** instead of listing eight all-time metrics: where the
  project stands (sequences × departments), what is late or blocked, who carries what, and
  at what pace for which projected end. Due dates can be dragged across the calendar.
- **Comments have states**: open, working on it, question, won't fix, resolved — each with
  its colour, a resolve button on the card, the rest on right-click, and a filter for the
  thread.
- **Faster first load**: the review space and the admin tabs are no longer downloaded before
  the sign-in screen. First load went from 724 to 401 kB compressed.
- **Fixed**: on a shot page, “copy link” copied the address of an unrelated asset. Pressing
  `I` on a video both set a loop point and switched the whole screen to Trim mode.
  Reordering a playlist was impossible as soon as one of its versions was in the trash.
  Creating or renaming a playlist never reached ShotGrid, although adding and removing did.

## 2026-08 — Messaging & member profiles

- **Direct messages and group threads**, in the presence panel at the bottom of the sidebar.
  Click someone to write to them; the `+` button opens a group. The conversation window
  follows you as you navigate, so you can answer without leaving a review.
- **Member pages**: click a name to see who does what — job title, bio, status and the
  projects you share. Contact details stay hidden from external client accounts.
- **Fixed**: job title, phone and bio saved in your profile came back empty after a reload.
  They were stored correctly, but the session did not carry them back.

## 2026-08 — Pipeline API for DCCs, Prism and bots

- **New integration API** under `/api/v1`, meant for tools rather than the web interface:
  publish a playblast from Maya or Blender, let Prism declare shots, feed a Discord bot.
  It is documented at **`/api/docs`** and versioned — it will not change under your scripts.
- **Address shots by name**, not by database id: `PROJ/SQ010/SH0100/anim` resolves to the
  right task, whatever the case you typed. Missing sequences, shots and tasks are created
  on the fly when you publish.
- **Publish in two calls**: one to open the version and get an upload link, one to close it.
  Re-running the same request after a network drop no longer creates a duplicate version.
- **Service tokens** (Admin → Identity & API): machine identities for a render farm or a
  bot, with fine-grained permissions and, if you want, access to a single project.
- **Event feed**: a studio daemon behind a firewall can now poll `/api/v1/events` instead
  of waiting for a webhook it cannot receive.

## 2026-08 — ReView is now AGPL-3.0

- **New license**: ReView moves from MIT to the **GNU AGPL v3 or later**. You can still run
  it, modify it and build a business on it; what changes is that a modified version offered
  to other people — including as a hosted service — must come with its source.
- **Running a modified instance?** Set your repository URL in **Admin → Settings → "Code
  source (AGPL §13)"**. It feeds the "Source code" link shown on the login screen, on client
  share pages and in **Admin → System → License & source**.
- **Third-party attribution**: `THIRD-PARTY-NOTICES.md` now lists all 594 redistributed
  dependencies with their license texts.
- **Commercial license available** for studios that cannot accept the AGPL — see
  `COMMERCIAL-LICENSE.md`.
- Versions published before this change **remain available under MIT**.

## 2026-08 — USD scene graph, per-prim gizmo & review layout

- **Selection outline fixed**: the highlight now hugs the selected object wherever it sits in
  the scene (it used to drift on assets far from the origin).
- **`F` frames the selection**: with a prim selected, the camera flies to it and frames it.
- **Right-click an object in the viewer** for its settings — variants (including those carried
  by a parent), frame, hide, isolate, reset. A right-click drag is still fly navigation.
- **Move / rotate / scale a prim**: with a prim selected, the transform gizmo (`T`/`R`/`S` in
  *Clean* mode) edits that prim; the delta is saved in the ReView override and replayed for
  everyone once published, or attached to a comment after publication.
- **Exact isolation**: *Isolate* now hides exactly the siblings of the selected prim — including
  baked variant geometry — and works on large scenes.
- **More room for the viewer**: review pages open with the main sidebar collapsed; expand it
  any time, your preference elsewhere is untouched.
- **Shading variants work on large scenes**: variant baking now costs one small subtree per
  option instead of a full scene import, so scenes with hundreds of variant sets (book colors,
  prop looks) get every option baked. Options that could not be baked are greyed out in the
  menu instead of silently doing nothing.
- **No more duplicated geometry**: props carrying several variant sets (a plate with both a
  modeling and a shading variant) no longer show two copies when you switch one of them.
- **Prim gizmo on the geometry**: the move/rotate/scale gizmo now appears on the selected
  object and pivots around its center, wherever it sits in the scene.
- **Publish keeps your staging**: unsaved scene changes become the media's default scene when
  you publish — what you see is what reviewers get.
- **Navigate a comment's proposal**: selecting a comment with scene changes keeps them applied
  while you move the camera; return to the default scene with `Esc` or the floating button.

## 2026-08 — USD scene graph & overrides

- **Scene graph**: USD media open with the real prim tree in the *Scene* panel, including prims
  that are not currently rendered.
- **Pick a mesh**: click an object in the viewer to select its prim; right-click a prim to switch
  its variant, hide it, isolate it or reset it.
- **Instant variants**: every option is baked into the converted file, so switching is immediate
  and works on published media.
- **ReView overrides**: what you change (moved, scaled, hidden, look) is saved as a light delta
  replayed when the scene loads. Managers set the media's override before publication; after
  publication reviewers attach their proposals to a comment, replayed only with that comment.

## 2026-07 — USD scenes

- **USD review**: upload `.usd`, `.usdc`, `.usda`, `.usdz`, or a zipped folder holding a USD
  scene with its textures and referenced layers. Materials, variants and animation are
  preserved.
- **Root layer detection**: an archive containing several USD layers no longer opens the wrong
  one — the real root layer is found automatically and shown in the technical sheet.
- **Missing asset report**: textures or layers absent from an archive are listed instead of
  silently producing an untextured model.
- **Recompose a scene**: pick another variant or another purpose (render / proxy / guide) from
  the technical sheet to re-run the conversion. The original file is never modified.
- **Clearer failures**: a media that could not be processed now explains why, instead of just
  showing an error.

## 2026-07 — Everyday UX & personalization

- **Display preferences**: interface density (comfortable / compact), automatic theme that
  follows your system, and a per-account language switch — all in your profile under *Display*.
- **Customizable shortcuts**: rebind the global navigation shortcuts from the `?` cheat sheet;
  your bindings are saved to your account.
- **Right-click favorites**: pin projects, shots and assets from the context menu; a star marks
  pinned items and they show up in the sidebar.
- **Saved list views**: save the current filters of the Reviews list as a named view and recall
  them in one click.
- **Theater mode & detachable player**: an immersive in-window review mode, plus Picture-in-Picture
  for video.
- **Animated thumbnails**: hover a video review card to scrub through a live preview.
- **Studio theme**: administrators can set a studio accent color and logo, applied across the app
  and the sign-in page.

## 2026-07 — Splat editing & export

- Export a cleaned Gaussian splat (`.spz`) with your non-destructive edits baked in; the original
  file is always kept intact.
- Lighter progressive streaming for large splats, with a real download progress bar.
- Support for reading compact SOG splat files.

## 2026-07 — 3D inspection & camera

- Reliable GLB animations, skeleton debug overlay, material variants and embedded cameras.
- Import animated cameras from Alembic (`.abc`) samples.
- Curve editor: copy/paste keys and tangents.

## 2026-07 — Dailies, secure delivery & identity

- Dailies playlists and a live review room.
- Pro video player: ranges, hover sprite, multi-grid compare, safe areas.
- Secure delivery: burn-ins, watermarking, hardened share links, client UI.
- Identity & API: SSO/2FA, personal API tokens, webhooks, active session management.
