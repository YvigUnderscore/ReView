import type * as THREE from 'three';
import type { SdfVolumeData, SplatTransform } from '../../reviewTypes';
import { buildCropChecks, pointCropped } from '../editor/volumes/cropPoints';

/**
 * « Cuisson » (bake) des éditions non-destructives d'un splat pour l'**export nettoyé** (41.A) —
 * logique pure (Three utilisé pour les maths seulement, aucun WebGL) → testable.
 *
 * Le `PackedSplats` en mémoire reflète déjà la **suppression** (opacité 0) et les **transforms
 * de sous-ensembles** (Phase 28, écrites via `setSplat`). On applique ici les deux éditions
 * restantes qui vivent hors des données paquées : les **volumes de crop** (SDF, escamotage
 * géométrique — même sémantique que l'overlay « points ») et la **transformation TRS** globale
 * (gizmo). Le `baseFlip` d'import (11.E) n'est **pas** cuit : c'est une convention d'axes du
 * viewer, pas une édition — le fichier exporté reste dans la convention de l'original.
 */

/** Un splat cuit, valeurs physiques prêtes pour l'écriture (SPZ/PLY). Couleur en 0..1. */
export interface BakedSplat {
  center: [number, number, number];
  scales: [number, number, number];
  quaternion: [number, number, number, number];
  opacity: number;
  color: [number, number, number];
}

/** Itérateur des splats source — signature de `PackedSplats.forEachSplat`. */
export type ForEachSplat = (
  cb: (
    index: number,
    center: THREE.Vector3,
    scales: THREE.Vector3,
    quaternion: THREE.Quaternion,
    opacity: number,
    color: THREE.Color,
  ) => void,
) => void;

export interface BakeOptions {
  /** TRS globale (gizmo) appliquée au mesh — cuite dans chaque splat, ou null si identité. */
  transform: SplatTransform | null;
  /** Volumes de crop SDF (creuser/isoler) — les splats escamotés sont retirés. */
  volumes: SdfVolumeData[];
  /** Seuil d'opacité en dessous duquel un splat est considéré masqué (défaut 0). */
  opacityEpsilon?: number;
}

function isIdentityTransform(t: SplatTransform): boolean {
  const [px, py, pz] = t.position;
  const [qx, qy, qz, qw] = t.quaternion;
  const [sx, sy, sz] = t.scale;
  return (
    px === 0 &&
    py === 0 &&
    pz === 0 &&
    qx === 0 &&
    qy === 0 &&
    qz === 0 &&
    qw === 1 &&
    sx === 1 &&
    sy === 1 &&
    sz === 1
  );
}

/**
 * Cuit les splats édités en une liste prête à écrire. Ordre des éditions calqué sur le viewer :
 * le crop et le masque s'évaluent en **espace local** (données paquées brutes), puis la TRS
 * globale est appliquée. Les splats masqués/croppés sont exclus.
 */
export function bakeSplats(
  three: typeof import('three'),
  forEach: ForEachSplat,
  opts: BakeOptions,
): BakedSplat[] {
  const checks = buildCropChecks(three, opts.volumes);
  const eps = opts.opacityEpsilon ?? 0;
  const transform = opts.transform && !isIdentityTransform(opts.transform) ? opts.transform : null;

  // Rotation/échelle de la TRS globale (pré-calculées) — la position translate le centre.
  const rot = new three.Quaternion();
  const scl = new three.Vector3(1, 1, 1);
  const pos = new three.Vector3();
  if (transform) {
    pos.fromArray(transform.position);
    rot.fromArray(transform.quaternion);
    scl.fromArray(transform.scale);
  }
  const mat = new three.Matrix4().compose(pos, rot, scl);

  const out: BakedSplat[] = [];
  const c = new three.Vector3();
  const q = new three.Quaternion();
  forEach((_index, center, scales, quaternion, opacity, color) => {
    if (opacity <= eps) return; // splat masqué (suppression non-destructive)
    if (checks.length && pointCropped(center.x, center.y, center.z, checks)) return; // volumes de crop
    c.copy(center);
    q.copy(quaternion);
    let sx = scales.x;
    let sy = scales.y;
    let sz = scales.z;
    if (transform) {
      c.applyMatrix4(mat);
      q.premultiply(rot); // orientation monde = rotation globale × orientation locale
      sx *= scl.x;
      sy *= scl.y;
      sz *= scl.z;
    }
    out.push({
      center: [c.x, c.y, c.z],
      scales: [sx, sy, sz],
      quaternion: [q.x, q.y, q.z, q.w],
      opacity,
      color: [color.r, color.g, color.b],
    });
  });
  return out;
}
