// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Comment draft persisted locally per media (32.C): composer text and in-progress 2D
 * annotation shapes. Restored when the review mounts, purged on send. Stored in
 * localStorage (per browser), failing silently (quota, private mode).
 */

export interface CommentDraft {
  content?: string;
  shapes?: unknown[];
}

const key = (mediaId: number) => `review-draft-${mediaId}`;

const isEmpty = (d: CommentDraft) => !(d.content ?? '').trim() && !(d.shapes?.length ?? 0);

export function loadDraft(mediaId: number): CommentDraft | null {
  try {
    const raw = localStorage.getItem(key(mediaId));
    if (!raw) return null;
    const d = JSON.parse(raw) as CommentDraft;
    return isEmpty(d) ? null : d;
  } catch {
    return null;
  }
}

/** Merges `patch` into the media's draft; removes the entry once it is empty. */
export function saveDraft(mediaId: number, patch: CommentDraft): void {
  try {
    const next = { ...(loadDraft(mediaId) ?? {}), ...patch };
    if (isEmpty(next)) localStorage.removeItem(key(mediaId));
    else localStorage.setItem(key(mediaId), JSON.stringify(next));
  } catch {
    /* storage unavailable: the draft is simply lost */
  }
}

export function clearDraft(mediaId: number): void {
  try {
    localStorage.removeItem(key(mediaId));
  } catch {
    /* ignore */
  }
}
