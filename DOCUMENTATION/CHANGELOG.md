# Changelog

Product release notes, newest first. Each `##` entry appears in the in-app **What's new**
panel. Keep entries short and user-facing (features and notable fixes, not internals).

## 2026-09-17 — The client portal: a home page, four tabs, and the drawing tools

A share link no longer opens on a flat grid of files. It opens on a **home page** carrying the
playlists the link gives access to and the latest published media, with a one-line inventory
of what the link actually contains. Below it, four tabs — **Review**, **Sequences**, **Shots**,
**Assets** — let a client find a shot the way the studio talks about it. A tab with nothing in
it is not shown, so the portal never names a level the link does not reach.

On a link that allows comments, the client now gets **the studio's own drawing tools** —
freehand, rectangle, ellipse, arrow, polygon, text, move, eraser, ink and thickness, with undo
and redo — on all four kinds of media. The drawing travels with the comment, on the frame it
was made on, and reopens in the artist's review with the shape in the right place. The thread
shows the timecode *and* the frame number in the project's own numbering. A drawing with no
text is a valid note.

Spatial media now open **as the supervisor staged them**: the share carries the persisted
splat edits, the USD override, the camera presentation, the project lighting and its HDRI,
where it previously served the raw file. Where you are in the portal lives in the address, so
the browser's Back button works and a client can point a colleague at the exact shot.

Hidden shots, sequences and assets no longer reach a share link — they were listed before,
and an organised portal would have shown their names and codes.

## 2026-09-14 — ShotGrid: one door out, and it is locked

- **Every write to the site now goes through a single path.** The project-isolation checks
  were already there and already correct — but they depended on whoever wrote the next line
  of code remembering to call them, and one module had quietly copied them by hand instead.
  They are now applied in one place, for creates, updates and file uploads alike, and a test
  fails the build if any code reaches the site another way.
- **A creation cannot name a project.** The linked project is set by the writer itself, a
  payload that names a different one is refused before anything leaves, and what the site
  actually filed is read back and checked.

## 2026-09-14 — ShotGrid: status and people changes can reach ReView too

- **A recipe for the two entity types ShotGrid hides.** A webhook filtered on a project
  cannot carry `Status` or `HumanUser` — neither belongs to a project, and ShotGrid simply
  leaves them out of the list. The admin guide now spells out the second webhook that does:
  same address, same secret, **no project**, those two entity types only. It brings nothing
  else with it.
- **A burst of people changes no longer replays the project once per person.** A status or
  an account triggers the same work whatever its id — one re-read of the whole hierarchy —
  so those events are now grouped on their type alone. Fifty accounts renamed at once used
  to queue fifty identical full passes.

## 2026-09-14 — ShotGrid: deleting on the site now reaches ReView

- **A deletion made in ShotGrid is applied within seconds.** It was not: the event arrived,
  was queued, ran, and did nothing at all — the run closed *succeeded* with empty counts,
  and the deletion only landed when someone ran a full synchronisation by hand. Retiring a
  sequence, a shot, an asset, a task or a version now moves the ReView counterpart to the
  bin as the event lands.
- **The bin, never an erasure.** Media, comments, decisions and history stay readable, the
  link survives, and restoring the entity on the site brings *that* one back rather than a
  copy. A task carrying versions is still kept rather than removed, as before.
- **A note deleted on the site is reported, not obeyed.** A comment has no bin of its own,
  so honouring the deletion would erase a review exchange for good. The run log says which
  comment is concerned and leaves the decision to a person.
- **An entity that moved to another project is not treated as deleted.** ReView asks the
  site again before binning anything: if it still answers, nothing is touched.

## 2026-09-14 — ShotGrid: the webhook that could never work, and the images it was not bringing

- **The webhook secret is finally readable.** A project link was born with a signature
  secret that nothing displayed — so ShotGrid signed with a different one, ReView refused
  every delivery with a `404`, and the site switched the endpoint off after a hundred
  failures. *Settings → Events* now shows it, copies it, and can generate a new one. Paste
  it into the webhook's **Secret token** field and deliveries start being accepted.
- **A refusal now says which half is wrong.** The answer to the site is unchanged — an
  unknown address and a bad signature look identical from outside, on purpose — but the
  server log distinguishes *unknown token* from *invalid signature*, and says so plainly.
  A connection test that goes through is logged as well, so a successful setup looks
  different from a silent one.
- **Shot, sequence and asset thumbnails come in.** The image production chose on the site
  is brought across and put on the card, instead of leaving it blank until some published
  media eventually supplies one. It follows changes: replace the image in ShotGrid and the
  card follows. Nothing is transferred when nothing changed, and a thumbnail you dropped on
  a shot by hand is never overwritten. Switch it off under *Publishes → Bring in ShotGrid
  thumbnails*.

## 2026-09-11 — Say what the person you hand a version to should look at

- **A brief beside each name.** Handing a version over said *who* was expected and never
  *at what* — the person opened four minutes of playblast with no idea whether the light,
  the timing or the cut was the question. Each name now carries one line saying what that
  person should look at. It is **per person**: "the lighting" to the lighting lead and "the
  cut at 1042" to the editor are two different requests.
- **Said at the moment you deliver.** *Publish* — from the review, or the ✚ beside *Publish*
  in the **Pending drafts** pill — now opens *Publish and hand over the review*: the names,
  the briefs, and the publication in one gesture. The artist who just delivered may hand
  their own version over; it grants them nothing else, the decision is still supervision's.
- **Read where it is needed.** Whoever the version was handed to sees their own line at the
  top of the review, above the viewer, the moment they open the media. Rewriting a brief
  tells them again; it does not re-subscribe them to a version they had chosen to leave.
- **A studio can demand it.** *Project → Settings → Brief for the ReViewer* makes the brief
  mandatory and sets a minimum length (5 characters by default, so "ok" does not count). It
  inherits studio → project like every other setting, and it holds through the interface and
  the integration API alike. Requiring it never forces you to name anyone: publishing with
  nobody in particular stays one click.

## 2026-09-11 — Hand a version to someone, and find your own queue on arrival

- **« Assigned to me », in front of the Reviews page.** The page said what had come out of the
  studio; it did not say what was waiting for *you*. The versions someone handed you are now
  the first thing on it, with a count and a way into the full list — and the panel steps aside
  entirely when nothing is waiting.
- **Ask someone to review a version.** The decision dialog gained a *Reviewers* line: a
  supervisor opens the project's directory, clicks a name to hand the version over, clicks it
  again to take it back. Until now that request lived in a corridor or a chat thread, and it
  stayed there.
- **The person hears about it.** They get a notification that opens straight onto the review
  screen — in their own language, on the bell and in the browser — and start following the
  version, so the comments and the decision that follow reach them too.
- **A filter that goes with it.** *Assigned to me* sits next to the decision filter and travels
  into a saved view, for the pass where you want the whole queue and not just its head.

## 2026-09-10 — See what a new release changes, and take it from the administration

- **A screen that says which release you run, and what a newer one would change.** Admin →
  Maintenance → Updates lists the notes of *every* release published since yours, not just the
  last one — skipping three at once is the normal case, and what changes comes from all three.
- **Back up in one click, and check that the backup is real.** The list shows when each one was
  taken, how large the dump is, which release it came from, and whether the secrets travel with
  it. *Check* restores it into a throwaway database and counts what comes out: a backup that has
  never been restored is not a backup.
- **Update without opening a terminal.** The instance backs up, switches, waits until it reports
  itself healthy, and puts the previous release back by itself if it does not come up. The screen
  keeps following the operation *through the cut* — the API it was talking to is the one being
  replaced — and picks the output back up where it stopped.
- **Nothing here is ever a greyed-out button.** An instance that cannot act on itself prints the
  exact command to run instead, with a copy button. That half of the screen works everywhere.

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

## 2026-08-28 — Change fifty shots at once, and find the setting you are looking for

- **A status you can set on a whole selection.** Picking fifty shots and setting them to
  *Ready for review* one by one was a morning's work; it is now one menu. The permission it
  asks for is the one you actually hold **on that project** — a supervisor promoted on a
  single show used to be refused because only the studio-wide role was read.
- **A task created straight from the shot.** No more going round by the kanban to add the
  one task that was missing: the shot and the asset both offer it where you are already
  looking.
- **Filters that survive the back button.** What you filtered a list by now lives in the
  address, so a view can be shared, bookmarked and returned to.
- **Settings you can search.** The admin pages are grouped, save group by group, and have a
  search field — twenty-eight sections were becoming a memory exercise.
- **A backup you can actually restore.** The archive now carries the `.env` it was encrypted
  with; without it, a restore on a fresh machine had nothing to decrypt with. The frontal
  also stops serving errors when a container comes back with a new address.

## 2026-08-27 — Briefs you compose, and a crash that no longer takes the page with it

- **The brief of a shot, written in blocks.** A section, a paragraph, a board of reference
  images, a progress gauge: you assemble them, drag them into order, and what is stored stays
  ordinary markdown that anything else can read. Images are uploaded into the brief itself,
  and a studio template gives every new entity the same skeleton.
- **An error stays where it happened.** A viewer that fails no longer blanks the whole
  application: the workspace around it keeps working, and the page says what broke. An entity
  that does not exist, or that you may not see, now gets a real screen instead of a dead end.
- **Who is on a task, visible on the card.** Assignees show on the card, and the right-click
  menu assigns without leaving the list.
- **Dates in your language, labels for screen readers.** A pass over the interface: dates and
  numbers follow the reader's locale, and controls that were only an icon now have a name.

## 2026-08-26 — Production you can read at a glance

- **Assign a person to a shot, not only to a task.** A task carries the work, an entity
  carries the responsibility — the two are now separate, and the picker shows faces rather
  than a list of look-alike names.
- **Hide what the studio should not see.** An administration screen collects the elements
  withdrawn from the product, by hand or by rule, and it is the only place they are managed.
  A hidden element is hidden from everyone, administrators included.
- **A card that says what you came to look for.** Cards carry their pipeline steps, lists
  switch between cards and compact rows, and the choice is remembered per list and per
  account.
- **A brief that belongs to ReView.** The entity page carries its own markdown sheet next to
  the description imported from ShotGrid: one can be made readable without losing the other.
  The team working on that scope appears in the same header.
- **Search that ranks by how well it matches.** Descriptions are searched too, and the
  quality of the match decides the order — the field it was found in only breaks ties.
- **A global trash, assets in columns, departments with a face.** Emptying is one gesture,
  asset steps are compared side by side, departments carry an image, and a ShotGrid account
  can be tied to a ReView one.
- **Task visibility set per department.** A studio-level setting narrows the pipe to what a
  person actually touches, without hiding the rest from those who need it.

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
