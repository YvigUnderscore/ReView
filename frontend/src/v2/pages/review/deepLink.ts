// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Review deep links (32.E): `?frame=N` (absolute frame, based on startFrame) opens the review
 * at that frame; `?comment=ID` selects the comment (seek + annotation + camera restored).
 * Pure construction and parsing, tested.
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

/** Video time (s) of an absolute frame; clamped to 0 for a frame before the start. */
export function frameToTime(frame: number, startFrame: number, fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return 0;
  return Math.max(0, (frame - startFrame) / fps);
}
