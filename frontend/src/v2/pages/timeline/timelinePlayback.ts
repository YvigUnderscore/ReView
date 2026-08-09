// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TimelineClip } from '../../types/api';

/**
 * Lecture continue d'un montage — analyse PURE, testée (Phase 46).
 *
 * Le montage se joue comme un film : une seule barre de temps, de zéro à la fin, et aucune
 * interruption au passage d'un plan ou d'une séquence. Ce fichier tient la correspondance
 * entre ce temps global et le plan qui doit être à l'écran, à sa propre position.
 */

/** Le plan qui occupe l'instant `t` du montage (le dernier si `t` dépasse la fin). */
export function clipIndexAt(items: readonly TimelineClip[], t: number): number {
  if (items.length === 0) return -1;
  for (let i = 0; i < items.length; i++) {
    const clip = items[i]!;
    if (t < clip.startTime + clip.duration) return Math.max(0, i);
  }
  return items.length - 1;
}

/** Position à l'intérieur du plan, bornée à sa durée. */
export function localTimeAt(clip: TimelineClip, t: number): number {
  return Math.min(Math.max(t - clip.startTime, 0), clip.duration);
}

/** Temps global correspondant à une position locale dans un plan. */
export function globalTimeOf(clip: TimelineClip, localTime: number): number {
  return clip.startTime + Math.min(Math.max(localTime, 0), clip.duration);
}

/** Bande d'une séquence sur la barre de temps : de quand à quand, sous quel code. */
export interface SequenceSpan {
  sequenceId: number | null;
  sequenceCode: string | null;
  startTime: number;
  duration: number;
}

/**
 * Regroupe les plans consécutifs d'une même séquence.
 *
 * La barre de temps doit montrer d'un coup d'œil où l'on est dans le film : un trait fin
 * par plan ne suffit pas, il faut la respiration des séquences. Les plans hors séquence
 * forment leurs propres bandes plutôt que de fusionner avec la précédente.
 */
export function sequenceSpans(items: readonly TimelineClip[]): SequenceSpan[] {
  const spans: SequenceSpan[] = [];
  for (const clip of items) {
    const last = spans[spans.length - 1];
    if (last && last.sequenceId === clip.sequenceId && clip.sequenceId !== null) {
      last.duration += clip.duration;
      continue;
    }
    spans.push({
      sequenceId: clip.sequenceId,
      sequenceCode: clip.sequenceCode,
      startTime: clip.startTime,
      duration: clip.duration,
    });
  }
  return spans;
}

/** Le plan lisible suivant (les cartons n'ont rien à charger), null en fin de montage. */
export function nextPlayableIndex(items: readonly TimelineClip[], from: number): number {
  for (let i = from + 1; i < items.length; i++) if (items[i]!.mediaId !== null) return i;
  return -1;
}

/** Position `mm:ss` d'un instant du montage, pour l'afficher à côté de la durée totale. */
export function formatTimecode(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const total = Math.floor(safe);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
