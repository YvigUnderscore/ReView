// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CurveKey, Extrapolation } from './model';
import { slopeIn, slopeOut } from './tangents';

/**
 * Extrapolation d'une F-curve **hors** de ses clés (pré/post-infinity, façon DCC) — Phase 50, lot 7.
 * Pur et testable ; branché par `hermite.ts`, réglé par canal (`Channel.pre` / `Channel.post`).
 *
 * **Le défaut reproduit exactement le comportement d'origine.** Avant ce lot, une courbe tenait sa
 * valeur extrême au-delà de ses clés, sans que rien ne soit persisté : `constant` — la valeur de
 * repli quand `pre`/`post` sont absents — fait strictement cela. Une présentation caméra
 * enregistrée avant ce lot se rejoue donc à l'identique, sans migration de données.
 */

/** Extrémité concernée. */
export type ExtrapolationSide = 'pre' | 'post';

/** Ramène un temps hors bornes dans la période, en va-et-vient (`oscillate`) ou en cycle. */
function wrap(t: number, t0: number, period: number, pingPong: boolean): number {
  const q = (t - t0) / period;
  const turn = Math.floor(q);
  const frac = q - turn;
  // Va-et-vient : un tour sur deux se lit à l'envers. Le modulo négatif de JS impose le test
  // sur la parité du tour, pas sur son signe.
  const forward = !pingPong || Math.abs(turn % 2) === 0;
  return t0 + (forward ? frac : 1 - frac) * period;
}

/** Nombre de périodes franchies (négatif avant la première clé) — décalage de `cycleOffset`. */
const turns = (t: number, t0: number, period: number): number => Math.floor((t - t0) / period);

/**
 * Valeur d'une courbe au temps `t` **hors** de ses clés. `sampleInside` échantillonne la courbe
 * dans ses bornes (fourni par `hermite.ts`, qui possède l'interpolation).
 *
 * La prolongation `linear` suit la tangente qui touche l'intérieur de la courbe — côté sortant de
 * la première clé avant elle, côté entrant de la dernière après elle : c'est la continuation
 * naturelle de la courbe, définie pour tous les profils de tangente.
 */
export function extrapolateValue(
  keys: readonly CurveKey[],
  kind: Extrapolation,
  side: ExtrapolationSide,
  t: number,
  sampleInside: (time: number) => number,
): number {
  const first = keys[0];
  const last = keys[keys.length - 1];
  const edge = side === 'pre' ? first : last;
  if (kind === 'constant') return edge.v;
  if (kind === 'linear') {
    const slope = side === 'pre' ? slopeOut(keys, 0) : slopeIn(keys, keys.length - 1);
    return edge.v + slope * (t - edge.t);
  }
  const period = last.t - first.t;
  // Une courbe sans étendue temporelle n'a pas de cycle à rejouer.
  if (!(period > 0)) return edge.v;
  if (kind === 'oscillate') return sampleInside(wrap(t, first.t, period, true));
  const inside = sampleInside(wrap(t, first.t, period, false));
  if (kind === 'cycle') return inside;
  return inside + turns(t, first.t, period) * (last.v - first.v);
}
