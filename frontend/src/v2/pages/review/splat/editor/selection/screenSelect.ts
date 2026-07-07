import type { SplatSceneHandle } from '../../useSplat';
import { combineSelection, shapePredicate, type SelectCombine, type SelectionShape } from './shapes2d';

/**
 * Sélection écran des splats (10.G) : projette chaque centre (espace objet → monde → NDC →
 * pixels) et applique le prédicat 2D de la forme tracée (rectangle/lasso). Une seule passe
 * `forEachSplat` en one-shot au lâcher du drag (pas par frame) — garde-fou perf du plan.
 */
export function selectByShape(
  handle: SplatSceneHandle,
  viewport: { width: number; height: number },
  shape: SelectionShape,
  prev: ReadonlySet<number>,
  combine: SelectCombine,
): Set<number> {
  const { THREE, camera, mesh } = handle;
  const hit = shapePredicate(shape);
  const { width, height } = viewport;
  const v = new THREE.Vector3();
  const hits: number[] = [];
  mesh.updateWorldMatrix(true, false);
  mesh.forEachSplat((index, center, _scales, _quat, opacity) => {
    if (opacity <= 0) return; // splat masqué (suppression non-destructive) : insélectionnable
    v.copy(center).applyMatrix4(mesh.matrixWorld).project(camera);
    if (v.z >= 1 || v.z <= -1) return; // hors du frustum near/far (dont derrière la caméra)
    const x = (v.x * 0.5 + 0.5) * width;
    const y = (-v.y * 0.5 + 0.5) * height;
    if (hit(x, y)) hits.push(index);
  });
  return combineSelection(prev, hits, combine);
}
