// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatCamera } from '../../reviewTypes';
import { sampleAnimV2 } from '../channels/hermite';
import { animKeyTimes, animPlayDuration, CHANNEL_IDS, type CameraAnimV2 } from '../channels/model';

/** Points échantillonnés de la polyligne de trajectoire (positions monde). */
const TRAJECTORY_STEPS = 64;

/**
 * Signature de l'animation : la trajectoire n'est recalculée que si elle change.
 *
 * Elle ne regardait que le canal `px` (Phase 27) : déplacer une clé sur `py`, `pz` ou sur la cible
 * laissait la polyligne périmée à l'écran. Elle couvre désormais les huit canaux, la durée de
 * lecture et la boucle — tout ce dont `sampleTrajectory` dépend. Pur/testable.
 */
export function trajSignature(anim: CameraAnimV2): string {
  const parts: string[] = [`${animPlayDuration(anim)}`, anim.loop ? 'loop' : 'once'];
  for (const id of CHANNEL_IDS) {
    const keys = anim.channels[id]?.keys ?? [];
    parts.push(`${id}:${keys.map((k) => `${k.t},${k.v.toFixed(3)},${k.mode}`).join('|')}`);
  }
  return parts.join(';');
}

/**
 * Échantillonne la trajectoire de la caméra (positions) sur la durée de lecture, pour tracer la
 * polyligne dans la scène. `base` sert de repli aux canaux sans clé — la même pose que celle dont
 * part la caméra-objet, sinon la ligne et le mesh ne décrivent pas le même plan. Pur/testable.
 */
export function sampleTrajectory(
  anim: CameraAnimV2,
  base: SplatCamera,
): Array<{ x: number; y: number; z: number }> {
  if (animKeyTimes(anim).length < 2) return [];
  const duration = animPlayDuration(anim);
  if (duration <= 0) return [];
  const out: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i <= TRAJECTORY_STEPS; i++)
    out.push(sampleAnimV2(anim, (i / TRAJECTORY_STEPS) * duration, base).position);
  return out;
}
