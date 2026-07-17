import type { SplatCamera, SplatCameraKeyframe } from '../../reviewTypes';
import {
  animDuration,
  animKeyTimes,
  animPlayDuration,
  type Channel,
  type CameraAnimV2,
  type CurveKey,
} from './model';

/**
 * Échantillonnage des F-curves (Phase 17) : interpolation d'Hermite cubique par segment, tangentes
 * selon le mode de chaque clé — `auto` (Catmull-Rom, lissé), `linear`, `step` (palier), `free`
 * (poignées éditées à la main). Pur/testable. La pose à un temps `t` échantillonne chaque canal ;
 * un canal absent retombe sur la valeur de la pose de base (`base`).
 */

/** Pente sortante d'une clé (unités/ms) selon son mode. */
function outTangent(keys: CurveKey[], i: number): number {
  const k = keys[i];
  if (k.mode === 'free') return k.tout ?? 0;
  if (k.mode === 'linear') {
    const n = keys[i + 1];
    return n ? (n.v - k.v) / (n.t - k.t || 1) : 0;
  }
  // auto (Catmull-Rom) : pente sur les voisins.
  const prev = keys[i - 1] ?? k;
  const next = keys[i + 1] ?? k;
  return (next.v - prev.v) / (next.t - prev.t || 1);
}

/** Pente entrante d'une clé (unités/ms) selon son mode. */
function inTangent(keys: CurveKey[], i: number): number {
  const k = keys[i];
  if (k.mode === 'free') return k.tin ?? 0;
  if (k.mode === 'linear') {
    const p = keys[i - 1];
    return p ? (k.v - p.v) / (k.t - p.t || 1) : 0;
  }
  const prev = keys[i - 1] ?? k;
  const next = keys[i + 1] ?? k;
  return (next.v - prev.v) / (next.t - prev.t || 1);
}

/** Valeur d'un canal au temps `t` (ms), ou `fallback` si le canal est vide. */
export function evalChannel(channel: Channel | undefined, t: number, fallback: number): number {
  const keys = channel?.keys;
  if (!keys || keys.length === 0) return fallback;
  if (keys.length === 1) return keys[0].v;
  if (t <= keys[0].t) return keys[0].v;
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v;
  // Segment [i, i+1] contenant t.
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const k0 = keys[i];
  const k1 = keys[i + 1];
  if (k0.mode === 'step') return k0.v; // palier : maintient la valeur jusqu'à la clé suivante
  const dt = k1.t - k0.t || 1;
  const u = (t - k0.t) / dt;
  const m0 = outTangent(keys, i) * dt; // tangentes exprimées sur le paramètre u
  const m1 = inTangent(keys, i + 1) * dt;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return h00 * k0.v + h10 * m0 + h01 * k1.v + h11 * m1;
}

/**
 * Pose caméra au temps `timeMs`. En boucle, le temps est enroulé sur la durée ; sinon borné.
 * Les canaux absents prennent la valeur de `base` (pose de référence). `null` si l'animation n'est
 * pas jouable (moins de 2 temps de clés — le garde-fou est côté appelant, ici on renvoie `base`).
 */
export function sampleAnimV2(anim: CameraAnimV2, timeMs: number, base: SplatCamera): SplatCamera {
  // Durée de lecture effective (override réglable ou dernier temps de clé) — Phase 27.
  const duration = animPlayDuration(anim);
  const t =
    duration <= 0
      ? 0
      : anim.loop
        ? ((timeMs % duration) + duration) % duration
        : Math.min(Math.max(timeMs, 0), duration);
  const ch = anim.channels;
  const pose: SplatCamera = {
    position: {
      x: evalChannel(ch.px, t, base.position.x),
      y: evalChannel(ch.py, t, base.position.y),
      z: evalChannel(ch.pz, t, base.position.z),
    },
    target: {
      x: evalChannel(ch.tx, t, base.target.x),
      y: evalChannel(ch.ty, t, base.target.y),
      z: evalChannel(ch.tz, t, base.target.z),
    },
  };
  if (ch.fov || base.fov != null) pose.fov = evalChannel(ch.fov, t, base.fov ?? 60);
  if (ch.roll || base.roll != null) pose.roll = evalChannel(ch.roll, t, base.roll ?? 0);
  return pose;
}

/**
 * « Bake » l'animation v2 en keyframes v1 échantillonnées (export glTF) : les courbes lissées sont
 * échantillonnées à `fps` sur toute la durée, plus les temps de clés exacts, pour préserver la
 * forme des F-curves dans le format d'échange (interpolation linéaire entre samples).
 */
export function bakeToKeyframes(anim: CameraAnimV2, base: SplatCamera, fps = 24): SplatCameraKeyframe[] {
  const duration = animDuration(anim);
  const times = new Set<number>(animKeyTimes(anim));
  const step = 1000 / fps;
  for (let t = 0; t <= duration; t += step) times.add(Math.round(t));
  return [...times]
    .sort((a, b) => a - b)
    .map((t) => ({ t, pose: sampleAnimV2(anim, t, base), easing: 'linear' as const }));
}
