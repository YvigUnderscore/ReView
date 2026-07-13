import type { SplatCamera } from '../../reviewTypes';

/**
 * Helpers purs (testables) pour la **caméra-objet** dans la scène (Phase 17) : conversion entre la
 * pose de review (position + cible) et la représentation « objet » manipulable (position + regard).
 * L'orientation du mesh se fait via `Object3D.lookAt` côté Three ; ici on ne manipule que des
 * vecteurs, sans dépendance Three.
 */

export type Vec3 = { x: number; y: number; z: number };

/** Distance position→cible (rayon de regard conservé lors d'une réorientation au gizmo). */
export function lookDistance(pose: SplatCamera): number {
  const dx = pose.target.x - pose.position.x;
  const dy = pose.target.y - pose.position.y;
  const dz = pose.target.z - pose.position.z;
  return Math.hypot(dx, dy, dz);
}

/** Cible reconstruite depuis une position, une direction de vue (unitaire) et une distance. */
export function targetFromForward(position: Vec3, forward: Vec3, dist: number): Vec3 {
  const len = Math.hypot(forward.x, forward.y, forward.z) || 1;
  return {
    x: position.x + (forward.x / len) * dist,
    y: position.y + (forward.y / len) * dist,
    z: position.z + (forward.z / len) * dist,
  };
}

/** Direction de vue unitaire d'une pose (position → cible), ou -Z par défaut si dégénérée. */
export function forwardOfPose(pose: SplatCamera): Vec3 {
  const dx = pose.target.x - pose.position.x;
  const dy = pose.target.y - pose.position.y;
  const dz = pose.target.z - pose.position.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-9) return { x: 0, y: 0, z: -1 };
  return { x: dx / len, y: dy / len, z: dz / len };
}
