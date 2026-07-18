# Annotations & comments

> Updated: 2026-07-19

Every review mode (video, image, 3D, splat) shares the same commenting system,
with drawing annotations on 2D media and full collaboration features: threads,
resolution, mentions, reactions, voice notes, deep links and kanban hand-off.

## Comments

- The comments panel lives beside the viewer (toggle from the review header; it
  stays accessible in unified fullscreen). It can be resized.
- On video, a comment is **anchored to the current frame**: clicking it later jumps
  the player back to that exact frame. Timeline markers show where feedback lives.
- Comments support **attachments** (pasted or uploaded images, PDF/zip/text files,
  and recorded voice notes).
- **Threads**: reply under any root comment; replies are nested with the thread.
- **Editing**: authors can edit their own comments; edited comments carry a small
  *modifié* badge. Authors and supervisors can delete.
- **Reactions**: emoji reactions (restricted set) on any comment, one per user
  and emoji, toggled by clicking.
- **Drafts**: the composer text and any in-progress 2D drawing are saved locally
  per media. Leaving the review (or reloading) keeps your draft; it is cleared
  when the comment is sent.

## Resolution

- Root comments can be marked **Resolved** (author or `SUPERVISOR`/`ADMIN`) with
  the check button on the card; resolved cards are dimmed and show a *Résolu*
  badge with who resolved and when (tooltip). Re-open at any time.
- The panel header shows the **open counter** (`N ouverts / total`) and a filter
  (*Tous / Ouverts / Résolus*).

## Mentions

- Type `@` in the composer (or a reply) to autocomplete **project members**.
  Navigate with the arrow keys, insert with Enter/Tab.
- A mention handle is the member's username, or the local part of their email
  when no username is set.
- Mentioned members receive a targeted **notification** that opens the review;
  mentions are highlighted in the thread.

## Voice notes

- The microphone button in the composer records a voice note (WebM/Opus). Stop to
  attach it; it is anchored to the frame like the rest of the comment and plays
  inline in the thread with an audio player.

## Deep links

- Viewer right-click (video) → **Copier le lien à cette frame** copies a URL with
  `?frame=N`; opening it seeks the review to that exact frame.
- Comment card right-click → **Copier le lien au commentaire** copies a URL with
  `?comment=ID`; opening it selects the comment (seek + annotation + camera
  restored) and scrolls to its card.

## Comment → kanban task

- `SUPERVISOR`/`ADMIN`: right-click a comment card → **Créer une tâche kanban**.
  The task is attached to the shot/asset carrying the media's version, named
  after the comment text, and inherits the comment's assignee.
- The task page shows a **Commentaire d'origine** chip linking back to the review
  at the exact frame/annotation.

## Watching (notification subscriptions)

- Right-click a **version card**, a **shot card** or an **asset card** →
  *Suivre / Ne plus suivre*.
- Watchers are notified of new root comments, media publications and review
  decisions on the watched item (and anything in its chain: watching a shot
  covers its versions). Actors and already-notified users are excluded.

## Annotations

- Drawing tools (pen, shapes) with **color choices**, drawn as an overlay.
- Annotations are anchored to the **delivery frame** (the letterbox guide), so they
  survive window resizes and fullscreen switches.
- On video they are timestamped: each annotated frame is flagged on the timeline.

## Roles

All project members can comment; `CLIENT` users can be limited to viewing or
commenting depending on how they access the project (membership or share link
permission `VIEW` / `COMMENT`). Resolution, comment→task and client visibility
toggles are restricted as described above.

## Related pages

- [Review video](review-video.md), [Review image](review-image.md)
- [Kanban & tasks](kanban-and-tasks.md) — tasks created from comments
- [Review approvals](review-approvals.md) — decisions notify watchers
- [Sharing](sharing.md) — client access permissions
