import type { SplatMesh } from '@sparkjsdev/spark';
import type { SplatSceneHandle } from '../../useSplat';
import { combineSelection, shapePredicate, type SelectCombine, type SelectionShape } from './shapes2d';

/**
 * Sélection écran des splats (10.G, perf revue en V2) : les centres sont capturés **une seule
 * fois** en `Float32Array` (une passe `forEachSplat` au premier commit), puis chaque commit
 * projette ce tampon par la matrice combinée (objet → monde → clip → pixels) dans une boucle
 * plate — sans objets Three par splat ni redépaquetage. Les splats masqués (suppression
 * non-destructive) sont exclus via `isHidden` (le tampon, lui, ne bouge jamais).
 */

/** Capture les centres de tous les splats (une passe) — cache de sélection. */
export function captureCenters(mesh: SplatMesh): Float32Array {
  const n = mesh.packedSplats?.numSplats ?? 0;
  const out = new Float32Array(n * 3);
  mesh.forEachSplat((i, center) => {
    const o = i * 3;
    out[o] = center.x;
    out[o + 1] = center.y;
    out[o + 2] = center.z;
  });
  return out;
}

/**
 * Projette les centres par la matrice clip (colonne-major THREE) et collecte les indices dont
 * la projection écran satisfait le prédicat. Pur et testable (aucune dépendance Three).
 */
export function collectHits(
  e: ArrayLike<number>,
  centers: Float32Array,
  isHidden: (index: number) => boolean,
  viewport: { width: number; height: number },
  hit: (x: number, y: number) => boolean,
): number[] {
  const { width, height } = viewport;
  const hits: number[] = [];
  const n = centers.length / 3;
  for (let i = 0; i < n; i++) {
    if (isHidden(i)) continue;
    const x = centers[3 * i];
    const y = centers[3 * i + 1];
    const z = centers[3 * i + 2];
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (w <= 0) continue; // derrière la caméra
    const cz = (e[2] * x + e[6] * y + e[10] * z + e[14]) / w;
    if (cz >= 1 || cz <= -1) continue; // hors du frustum near/far
    const sx = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / w) * 0.5 + 0.5;
    const sy = ((e[1] * x + e[5] * y + e[9] * z + e[13]) / w) * -0.5 + 0.5;
    if (hit(sx * width, sy * height)) hits.push(i);
  }
  return hits;
}

/** Applique une forme tracée à l'écran à la sélection courante (au lâcher du drag). */
export function selectByShape(
  handle: SplatSceneHandle,
  centers: Float32Array,
  isHidden: (index: number) => boolean,
  viewport: { width: number; height: number },
  shape: SelectionShape,
  prev: ReadonlySet<number>,
  combine: SelectCombine,
): Set<number> {
  const { THREE, camera, mesh } = handle;
  mesh.updateWorldMatrix(true, false);
  const m = new THREE.Matrix4()
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .multiply(mesh.matrixWorld);
  const hits = collectHits(m.elements, centers, isHidden, viewport, shapePredicate(shape));
  return combineSelection(prev, hits, combine);
}
