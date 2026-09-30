// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Liens profonds de review (32.E) : `?frame=N` (frame absolue, base startFrame)
 * ouvre la review à la frame ; `?comment=ID` sélectionne le commentaire (seek +
 * annotation + caméra restaurés). Construction et parsing purs, testés.
 */

export function frameLink(origin: string, pathname: string, frame: number): string {
  return `${origin}${pathname}?frame=${frame}`;
}

export function commentLink(origin: string, pathname: string, commentId: number): string {
  return `${origin}${pathname}?comment=${commentId}`;
}

export function parseDeepLink(search: string): { frame?: number; commentId?: number } {
  const params = new URLSearchParams(search);
  const frame = Number(params.get('frame'));
  const commentId = Number(params.get('comment'));
  return {
    ...(Number.isInteger(frame) && frame > 0 ? { frame } : {}),
    ...(Number.isInteger(commentId) && commentId > 0 ? { commentId } : {}),
  };
}

/** Temps vidéo (s) d'une frame absolue ; borné à 0 pour une frame antérieure au départ. */
export function frameToTime(frame: number, startFrame: number, fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return 0;
  return Math.max(0, (frame - startFrame) / fps);
}
