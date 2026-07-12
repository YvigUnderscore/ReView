import type { CameraEasing, SplatCamera, SplatCameraKeyframe } from '../../reviewTypes';

/**
 * Échantillonnage de l'animation caméra keyframe (10.G-V5) — pur et testable. Une pose =
 * position + cible (+ fov) ; l'easing d'un segment est porté par sa keyframe de départ.
 */

export function applyEasing(u: number, easing: CameraEasing): number {
  switch (easing) {
    case 'ease-in':
      return u * u;
    case 'ease-out':
      return 1 - (1 - u) * (1 - u);
    case 'ease-in-out':
      return u * u * (3 - 2 * u); // smoothstep
    default:
      return u;
  }
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const lerpVec = (
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  u: number,
) => ({
  x: lerp(a.x, b.x, u),
  y: lerp(a.y, b.y, u),
  z: lerp(a.z, b.z, u),
});

export function lerpPose(a: SplatCamera, b: SplatCamera, u: number): SplatCamera {
  const pose: SplatCamera = {
    position: lerpVec(a.position, b.position, u),
    target: lerpVec(a.target, b.target, u),
  };
  if (a.fov != null || b.fov != null) pose.fov = lerp(a.fov ?? b.fov ?? 60, b.fov ?? a.fov ?? 60, u);
  if (a.roll != null || b.roll != null) pose.roll = lerp(a.roll ?? 0, b.roll ?? 0, u);
  return pose;
}

// ── Interpolation par courbes (16.A) : spline Catmull-Rom uniforme ──────────────
// Trajectoire lissée passant par chaque keyframe (position/cible) — mouvement de caméra
// continu façon logiciel 3D. À u=0 renvoie p1, à u=1 renvoie p2 (passe par les poses).
function catmull1(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
  );
}
const catmullVec = (
  p0: { x: number; y: number; z: number },
  p1: { x: number; y: number; z: number },
  p2: { x: number; y: number; z: number },
  p3: { x: number; y: number; z: number },
  u: number,
) => ({
  x: catmull1(p0.x, p1.x, p2.x, p3.x, u),
  y: catmull1(p0.y, p1.y, p2.y, p3.y, u),
  z: catmull1(p0.z, p1.z, p2.z, p3.z, u),
});

/** Pose lissée sur le segment [i, i+1] (spline à travers les voisins), u∈[0,1] déjà « easé ». */
export function samplePoseSpline(keyframes: SplatCameraKeyframe[], i: number, u: number): SplatCamera {
  const k1 = keyframes[i].pose;
  const k2 = keyframes[i + 1].pose;
  const k0 = (keyframes[i - 1] ?? keyframes[i]).pose; // extrémités : voisin dupliqué
  const k3 = (keyframes[i + 2] ?? keyframes[i + 1]).pose;
  const pose: SplatCamera = {
    position: catmullVec(k0.position, k1.position, k2.position, k3.position, u),
    target: catmullVec(k0.target, k1.target, k2.target, k3.target, u),
  };
  if (k1.fov != null || k2.fov != null) pose.fov = lerp(k1.fov ?? k2.fov ?? 60, k2.fov ?? k1.fov ?? 60, u);
  if (k1.roll != null || k2.roll != null) pose.roll = lerp(k1.roll ?? 0, k2.roll ?? 0, u);
  return pose;
}

/** Durée totale de l'animation (t de la dernière keyframe). */
export function animDuration(keyframes: SplatCameraKeyframe[]): number {
  return keyframes.length > 0 ? keyframes[keyframes.length - 1].t : 0;
}

/**
 * Pose de la caméra au temps `timeMs`. En boucle, le temps est enroulé sur la durée ; sinon il
 * est borné à la dernière pose. `null` si moins de 2 keyframes (pas d'animation).
 * `smooth` (16.A) : interpolation par courbes Catmull-Rom au lieu de segments linéaires.
 */
export function sampleAnim(
  keyframes: SplatCameraKeyframe[],
  timeMs: number,
  loop: boolean,
  smooth = false,
): SplatCamera | null {
  if (keyframes.length < 2) return null;
  const duration = animDuration(keyframes);
  if (duration <= 0) return keyframes[0].pose;
  let t = loop ? ((timeMs % duration) + duration) % duration : Math.min(Math.max(timeMs, 0), duration);
  if (t < keyframes[0].t) t = keyframes[0].t;
  for (let i = 0; i < keyframes.length - 1; i++) {
    const k0 = keyframes[i];
    const k1 = keyframes[i + 1];
    if (t > k1.t) continue;
    const span = k1.t - k0.t;
    const u = span > 0 ? (t - k0.t) / span : 1;
    const eased = applyEasing(u, k0.easing);
    return smooth ? samplePoseSpline(keyframes, i, eased) : lerpPose(k0.pose, k1.pose, eased);
  }
  return keyframes[keyframes.length - 1].pose;
}

/**
 * Génère un tour d'orbite complet autour de la cible (preset « Orbite », 10.G-V5) : 8 poses +
 * retour à la pose de départ, easing linéaire (vitesse constante), rayon/hauteur conservés.
 */
export function orbitPreset(from: SplatCamera, durationMs = 12000): SplatCameraKeyframe[] {
  const { position, target } = from;
  const dx = position.x - target.x;
  const dz = position.z - target.z;
  const radius = Math.hypot(dx, dz) || 1;
  const start = Math.atan2(dz, dx);
  const steps = 8;
  const keyframes: SplatCameraKeyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = start + (i / steps) * Math.PI * 2;
    keyframes.push({
      t: Math.round((i / steps) * durationMs),
      pose: {
        position: {
          x: target.x + Math.cos(angle) * radius,
          y: position.y,
          z: target.z + Math.sin(angle) * radius,
        },
        target: { ...target },
        fov: from.fov,
      },
      easing: 'linear',
    });
  }
  return keyframes;
}
