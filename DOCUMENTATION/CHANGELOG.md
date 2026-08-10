# Changelog

Product release notes, newest first. Each `##` entry appears in the in-app **What's new**
panel. Keep entries short and user-facing (features and notable fixes, not internals).

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
