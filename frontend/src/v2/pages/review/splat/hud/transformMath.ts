/**
 * Conversions euler degrés ↔ quaternion (ordre XYZ intrinsèque, conventions three.js) pour les
 * champs numériques TRS (10.G-V4). Pur et sans dépendance Three — testable, et utilisable des
 * deux côtés (affichage du quaternion du gizmo en degrés, saisie en degrés → quaternion).
 */
export type Quat = [number, number, number, number];
export type EulerDeg = [number, number, number];

const RAD = Math.PI / 180;
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** Quaternion [x,y,z,w] → angles euler XYZ en degrés (mêmes formules que THREE.Euler). */
export function quatToEulerDeg([x, y, z, w]: Quat): EulerDeg {
  // Termes de la matrice de rotation nécessaires à l'ordre XYZ.
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - w * z);
  const m13 = 2 * (x * z + w * y);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - w * x);
  const m32 = 2 * (y * z + w * x);
  const m33 = 1 - 2 * (x * x + y * y);
  const ey = Math.asin(clamp(m13, -1, 1));
  let ex: number;
  let ez: number;
  if (Math.abs(m13) < 0.9999999) {
    ex = Math.atan2(-m23, m33);
    ez = Math.atan2(-m12, m11);
  } else {
    // Gimbal lock : Z arbitrairement à 0 (convention three.js).
    ex = Math.atan2(m32, m22);
    ez = 0;
  }
  return [ex / RAD, ey / RAD, ez / RAD];
}

/** Angles euler XYZ en degrés → quaternion [x,y,z,w] (mêmes formules que THREE.Quaternion). */
export function eulerDegToQuat([exDeg, eyDeg, ezDeg]: EulerDeg): Quat {
  const c1 = Math.cos((exDeg * RAD) / 2);
  const s1 = Math.sin((exDeg * RAD) / 2);
  const c2 = Math.cos((eyDeg * RAD) / 2);
  const s2 = Math.sin((eyDeg * RAD) / 2);
  const c3 = Math.cos((ezDeg * RAD) / 2);
  const s3 = Math.sin((ezDeg * RAD) / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}
