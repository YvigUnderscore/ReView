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
  return pose;
}

/** Durée totale de l'animation (t de la dernière keyframe). */
export function animDuration(keyframes: SplatCameraKeyframe[]): number {
  return keyframes.length > 0 ? keyframes[keyframes.length - 1].t : 0;
}

/**
 * Pose de la caméra au temps `timeMs`. En boucle, le temps est enroulé sur la durée ; sinon il
 * est borné à la dernière pose. `null` si moins de 2 keyframes (pas d'animation).
 */
export function sampleAnim(
  keyframes: SplatCameraKeyframe[],
  timeMs: number,
  loop: boolean,
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
    return lerpPose(k0.pose, k1.pose, applyEasing(u, k0.easing));
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
