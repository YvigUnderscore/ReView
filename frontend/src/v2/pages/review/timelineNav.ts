// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TimelineClip } from '../../types/api';

/**
 * Navigation dans un montage automatique (Phase 45) — analyse PURE, testée.
 *
 * Les cartons (plans sans média publié) comptent dans le montage : ils en donnent la
 * durée réelle et signalent ce qui manque. Mais ils ne sont pas lisibles, donc la lecture
 * les saute — l'enchaînement va d'un média au média suivant, sans s'arrêter sur un trou.
 */

/** Position du clip qui porte ce média, -1 s'il n'est pas dans ce montage. */
export function clipIndexOfMedia(items: readonly TimelineClip[], mediaId: number): number {
  return items.findIndex((it) => it.mediaId === mediaId);
}

/** Clip lisible le plus proche dans la direction donnée, null en bord de montage. */
export function playableNeighbor(
  items: readonly TimelineClip[],
  index: number,
  dir: -1 | 1,
): TimelineClip | null {
  if (index < 0) return null;
  for (let i = index + dir; i >= 0 && i < items.length; i += dir) {
    const clip = items[i];
    if (clip && clip.mediaId !== null) return clip;
  }
  return null;
}

/** Rang de lecture (1-based) d'un clip parmi les seuls clips lisibles, et leur total. */
export function playablePosition(
  items: readonly TimelineClip[],
  index: number,
): { position: number; total: number } {
  const total = items.filter((it) => it.mediaId !== null).length;
  if (index < 0) return { position: 0, total };
  const position = items.slice(0, index + 1).filter((it) => it.mediaId !== null).length;
  return { position, total };
}

/** Durée totale mise en forme `m:ss` (les montages de production restent sous l'heure). */
export function formatDuration(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const total = Math.round(safe);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}
