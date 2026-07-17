import type { SplatCamera } from '../../reviewTypes';
import { emptyAnim, upsertPoseAt, type CameraAnimV2 } from './model';

/**
 * Preset « Orbite » (Phase 17/27, v2) : un tour complet autour de la cible courante — 8 poses +
 * retour à la pose de départ, clés lissées (mode `auto`), hauteur conservée. En boucle par défaut.
 * `radiusScale` règle la distance caméra↔centre (multiplie le rayon courant, Phase 27).
 */
export function orbitPresetV2(
  from: SplatCamera,
  opts: { durationMs?: number; radiusScale?: number } = {},
): CameraAnimV2 {
  const durationMs = opts.durationMs ?? 12000;
  const { position, target } = from;
  const dx = position.x - target.x;
  const dz = position.z - target.z;
  const radius = (Math.hypot(dx, dz) || 1) * (opts.radiusScale ?? 1);
  const start = Math.atan2(dz, dx);
  const steps = 8;
  let anim = emptyAnim(true);
  for (let i = 0; i <= steps; i++) {
    const angle = start + (i / steps) * Math.PI * 2;
    anim = upsertPoseAt(anim, Math.round((i / steps) * durationMs), {
      position: {
        x: target.x + Math.cos(angle) * radius,
        y: position.y,
        z: target.z + Math.sin(angle) * radius,
      },
      target: { ...target },
      fov: from.fov,
    });
  }
  return anim;
}
