// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Brouillon de commentaire persisté localement par média (32.C) : texte du composer
 * et formes d'annotation 2D en cours. Restauré au montage de la review, purgé à
 * l'envoi. Stockage localStorage (par navigateur), silencieux en cas d'échec
 * (quota, mode privé).
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

/** Fusionne `patch` dans le brouillon du média ; supprime l'entrée devenue vide. */
export function saveDraft(mediaId: number, patch: CommentDraft): void {
  try {
    const next = { ...(loadDraft(mediaId) ?? {}), ...patch };
    if (isEmpty(next)) localStorage.removeItem(key(mediaId));
    else localStorage.setItem(key(mediaId), JSON.stringify(next));
  } catch {
    /* stockage indisponible : le brouillon est simplement perdu */
  }
}

export function clearDraft(mediaId: number): void {
  try {
    localStorage.removeItem(key(mediaId));
  } catch {
    /* ignore */
  }
}
