// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CameraAnimV2, ChannelId, KeyRef } from './model';

/**
 * Mise à l'échelle d'un lot de clés autour d'un pivot (boîte de transformation du curve editor,
 * Phase 50 lot 7) — pur et testable.
 *
 * La fonction ne **modifie rien** : elle rend la liste des déplacements, que le geste passe à
 * `moveKeysBatch` par le chemin déjà en place (baseline du drag, undo unique, tri maintenu). Rien de
 * neuf dans le modèle, donc rien de neuf à faire migrer.
 */

/** Déplacement demandé au modèle — même forme que celle des gestes de clés. */
export interface ScaledMove {
  channel: ChannelId;
  index: number;
  t: number;
  v: number;
}

/** Étendue d'un lot de clés (bornes de la boîte). */
export interface KeyBounds {
  tMin: number;
  tMax: number;
  vMin: number;
  vMax: number;
}

/** Bornes d'un lot de clés dans `anim`, ou `null` si aucune n'existe. */
export function keyBounds(anim: CameraAnimV2, refs: readonly KeyRef[]): KeyBounds | null {
  let bounds: KeyBounds | null = null;
  for (const r of refs) {
    const k = anim.channels[r.channel]?.keys[r.index];
    if (!k) continue;
    if (!bounds) bounds = { tMin: k.t, tMax: k.t, vMin: k.v, vMax: k.v };
    else {
      bounds.tMin = Math.min(bounds.tMin, k.t);
      bounds.tMax = Math.max(bounds.tMax, k.t);
      bounds.vMin = Math.min(bounds.vMin, k.v);
      bounds.vMax = Math.max(bounds.vMax, k.v);
    }
  }
  return bounds;
}

/**
 * Déplacements d'une mise à l'échelle : chaque clé s'éloigne (ou se rapproche) du pivot du facteur
 * donné, sur le temps, sur la valeur, ou sur les deux. Un facteur de 1 laisse l'axe intact.
 * `snapTime` sert à faire atterrir les temps sur une frame, comme tout déplacement de clé.
 */
export function scaleKeyMoves(
  anim: CameraAnimV2,
  refs: readonly KeyRef[],
  o: {
    pivotT: number;
    scaleT: number;
    pivotV: number;
    scaleV: number;
    snapTime?: (t: number) => number;
  },
): ScaledMove[] {
  const moves: ScaledMove[] = [];
  for (const r of refs) {
    const k = anim.channels[r.channel]?.keys[r.index];
    if (!k) continue;
    const t = o.pivotT + (k.t - o.pivotT) * o.scaleT;
    moves.push({
      channel: r.channel,
      index: r.index,
      t: Math.max(0, o.snapTime ? o.snapTime(t) : t),
      v: o.pivotV + (k.v - o.pivotV) * o.scaleV,
    });
  }
  return moves;
}

/**
 * Facteur d'échelle d'un geste : rapport des distances au pivot, de la position courante du
 * pointeur à celle du début. Sous une distance initiale négligeable, le rapport n'a pas de sens —
 * le facteur reste 1 plutôt que d'exploser.
 */
export function scaleFactor(from: number, to: number, pivot: number, epsilon: number): number {
  const span = from - pivot;
  if (Math.abs(span) < epsilon) return 1;
  return (to - pivot) / span;
}
