// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatCamera, SplatCameraKeyframe } from '../../reviewTypes';
import { extrapolateValue } from './extrapolate';
import {
  animBase,
  animDuration,
  animKeyTimes,
  animPlayDuration,
  type CameraAnimBase,
  type Channel,
  type CameraAnimV2,
  type CurveKey,
} from './model';
import { slopeIn, slopeOut, typeOut, weightOf } from './tangents';

/**
 * Échantillonnage des F-curves (Phase 17) : interpolation d'Hermite cubique par segment, tangentes
 * selon le profil de **chaque côté** de chaque clé (`tangents.ts` — lissée, linéaire, plate, palier,
 * libre). Pur/testable. La pose à un temps `t` échantillonne chaque canal ; un canal absent retombe
 * sur la valeur de la **base** : celle que l'animation porte si elle en porte une (Phase 50, lot
 * 13), sinon le `base` que l'appelant prête. C'est `model.animBase` qui arbitre, et cet unique
 * point de passage est ce qui garantit que le lecteur keyframe et le rig de scène — les deux
 * échantillonneurs — lisent la même chose.
 *
 * Deux extensions de la Phase 50 (lot 7), toutes deux **inertes par défaut** — une présentation
 * enregistrée avant elles se rejoue au caractère près :
 * - **tangentes pondérées** : un segment dont une extrémité porte un poids s'évalue en Bézier
 *   cubique résolu en x. Un Hermite EST le Bézier de poids 1, donc l'extension est exacte ; le
 *   chemin pondéré ne sert que si un poids est écrit dans la clé.
 * - **pré/post-infinity** : hors des clés, la courbe suivait la valeur extrême ; c'est exactement
 *   `constant`, le repli quand le canal ne règle rien.
 */

/** Bézier cubique scalaire (un axe) au paramètre `u`. */
const bez = (a: number, b: number, c: number, d: number, u: number): number => {
  const s = 1 - u;
  return s * s * s * a + 3 * s * s * u * b + 3 * s * u * u * c + u * u * u * d;
};

/**
 * Segment à tangentes **pondérées** : Bézier cubique dont les points de contrôle sont à `w × dt/3`
 * de chaque clé. x étant croissant (poids bornés par `clampWeight`), le paramètre se retrouve par
 * bissection — 24 tours, soit un résidu de l'ordre du dix-millionième de segment.
 */
function evalWeighted(k0: CurveKey, k1: CurveKey, t: number, m0: number, m1: number): number {
  const dt = k1.t - k0.t || 1;
  const d0 = (weightOf(k0, 'out') * dt) / 3;
  const d1 = (weightOf(k1, 'in') * dt) / 3;
  const x1 = k0.t + d0;
  const x2 = k1.t - d1;
  const y1 = k0.v + m0 * d0;
  const y2 = k1.v - m1 * d1;
  let lo = 0;
  let hi = 1;
  for (let n = 0; n < 24; n++) {
    const u = (lo + hi) / 2;
    if (bez(k0.t, x1, x2, k1.t, u) < t) lo = u;
    else hi = u;
  }
  return bez(k0.v, y1, y2, k1.v, (lo + hi) / 2);
}

/** Valeur **dans** les bornes de la courbe (bornée aux extrêmes) — au moins deux clés. */
function evalInside(keys: readonly CurveKey[], t: number): number {
  if (t <= keys[0].t) return keys[0].v;
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v;
  // Segment [i, i+1] contenant t.
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const k0 = keys[i];
  const k1 = keys[i + 1];
  if (typeOut(k0) === 'step') return k0.v; // palier : maintient la valeur jusqu'à la clé suivante
  const dt = k1.t - k0.t || 1;
  const s0 = slopeOut(keys, i);
  const s1 = slopeIn(keys, i + 1);
  if (k0.wOut != null || k1.wIn != null) return evalWeighted(k0, k1, t, s0, s1);
  const u = (t - k0.t) / dt;
  const m0 = s0 * dt; // tangentes exprimées sur le paramètre u
  const m1 = s1 * dt;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return h00 * k0.v + h10 * m0 + h01 * k1.v + h11 * m1;
}

/** Valeur d'un canal au temps `t` (ms), ou `fallback` si le canal est vide. */
export function evalChannel(channel: Channel | undefined, t: number, fallback: number): number {
  const keys = channel?.keys;
  if (!keys || keys.length === 0) return fallback;
  if (keys.length === 1) return keys[0].v;
  const inside = (time: number) => evalInside(keys, time);
  if (t < keys[0].t) return extrapolateValue(keys, channel.pre ?? 'constant', 'pre', t, inside);
  if (t > keys[keys.length - 1].t)
    return extrapolateValue(keys, channel.post ?? 'constant', 'post', t, inside);
  return inside(t);
}

/**
 * Pose caméra au temps `timeMs`. En boucle, le temps est enroulé sur la durée ; sinon borné.
 * Les canaux absents prennent la valeur de la base effective — celle de l'animation si elle en
 * porte une, sinon le `base` prêté (`model.animBase`). `null` si l'animation n'est pas jouable
 * (moins de 2 temps de clés — le garde-fou est côté appelant, ici on renvoie la base).
 */
export function sampleAnimV2(anim: CameraAnimV2, timeMs: number, base: CameraAnimBase): SplatCamera {
  // Durée de lecture effective (override réglable ou dernier temps de clé) — Phase 27.
  const duration = animPlayDuration(anim);
  const t =
    duration <= 0
      ? 0
      : anim.loop
        ? ((timeMs % duration) + duration) % duration
        : Math.min(Math.max(timeMs, 0), duration);
  const ch = anim.channels;
  // Base persistée si l'animation en porte une, sinon celle que l'appelant prête (repli hérité).
  const b = animBase(anim, base);
  const pose: SplatCamera = {
    position: {
      x: evalChannel(ch.px, t, b.position.x),
      y: evalChannel(ch.py, t, b.position.y),
      z: evalChannel(ch.pz, t, b.position.z),
    },
    target: {
      x: evalChannel(ch.tx, t, b.target.x),
      y: evalChannel(ch.ty, t, b.target.y),
      z: evalChannel(ch.tz, t, b.target.z),
    },
  };
  if (ch.fov || b.fov != null) pose.fov = evalChannel(ch.fov, t, b.fov ?? 60);
  if (ch.roll || b.roll != null) pose.roll = evalChannel(ch.roll, t, b.roll ?? 0);
  return pose;
}

/**
 * « Bake » l'animation v2 en keyframes v1 échantillonnées (export glTF) : les courbes lissées sont
 * échantillonnées à `fps` sur toute la durée, plus les temps de clés exacts, pour préserver la
 * forme des F-curves dans le format d'échange (interpolation linéaire entre samples). Les canaux
 * non clés suivent la base de l'animation quand elle en porte une : le fichier exporté ne dépend
 * plus de la vue de celui qui exporte.
 */
export function bakeToKeyframes(anim: CameraAnimV2, base: CameraAnimBase, fps = 24): SplatCameraKeyframe[] {
  const duration = animDuration(anim);
  const times = new Set<number>(animKeyTimes(anim));
  const step = 1000 / fps;
  for (let t = 0; t <= duration; t += step) times.add(Math.round(t));
  return [...times]
    .sort((a, b) => a - b)
    .map((t) => ({ t, pose: sampleAnimV2(anim, t, base), easing: 'linear' as const }));
}
