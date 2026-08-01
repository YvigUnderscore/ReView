/**
 * Pivot du gizmo TRS par prim (46.Q) — mathématiques **pures**.
 *
 * Le gizmo ne peut pas être attaché à l'objet lui-même : avec des transformations cuites dans
 * les sommets (export Blender), l'origine locale de l'objet est souvent au centre du monde, et
 * le gizmo apparaissait au milieu de la scène au lieu d'être sur la géométrie manipulée. Il est
 * donc posé sur un **proxy** placé au centre englobant du prim, et chaque delta du proxy est
 * retraduit en pose de l'objet, pivotée autour de ce centre.
 */

export type Vec3 = [number, number, number];
/** Quaternion en composantes [x, y, z, w] — l'ordre de `THREE.Quaternion.toArray()`. */
export type Quat = [number, number, number, number];

export const IDENTITY_QUAT: Quat = [0, 0, 0, 1];

/** Produit de quaternions (a ∘ b : applique b puis a). */
export function mulQuat(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Rotation d'un vecteur par un quaternion (forme optimisée classique, sans matrice). */
export function rotateVec(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

/** Pose locale d'un objet dans l'espace de son parent. */
export interface Pose {
  position: Vec3;
  quaternion: Quat;
  scale: Vec3;
}

/** Delta relevé sur le proxy du gizmo depuis le début du drag, exprimé dans l'espace parent. */
export interface PivotDelta {
  t: Vec3;
  q: Quat;
  s: Vec3;
}

/**
 * Pose de l'objet après application du delta **autour du pivot** : l'offset objet→pivot est
 * mis à l'échelle puis tourné, l'orientation composée, l'échelle multipliée. Tout est exprimé
 * dans l'espace parent de l'objet — l'appelant y convertit le delta monde du proxy.
 */
export function pivotedPose(base: Pose, pivot: Vec3, delta: PivotDelta): Pose {
  const offset: Vec3 = [
    (base.position[0] - pivot[0]) * delta.s[0],
    (base.position[1] - pivot[1]) * delta.s[1],
    (base.position[2] - pivot[2]) * delta.s[2],
  ];
  const rotated = rotateVec(delta.q, offset);
  return {
    position: [
      pivot[0] + rotated[0] + delta.t[0],
      pivot[1] + rotated[1] + delta.t[1],
      pivot[2] + rotated[2] + delta.t[2],
    ],
    quaternion: mulQuat(delta.q, base.quaternion),
    scale: [base.scale[0] * delta.s[0], base.scale[1] * delta.s[1], base.scale[2] * delta.s[2]],
  };
}
