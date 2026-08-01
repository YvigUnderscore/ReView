# Changelog

Product release notes, newest first. Each `##` entry appears in the in-app **What's new**
panel. Keep entries short and user-facing (features and notable fixes, not internals).

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
