import type * as THREE from 'three';
import type { SplatMesh } from '@sparkjsdev/spark';

/**
 * Bbox locale des splats **visibles** (opacité > 0) — 11.D. `mesh.getBoundingBox` de Spark lit
 * les données d'origine et compte donc les splats masqués par la suppression non-destructive :
 * après une suppression, F/H recadraient sur l'étendue d'avant. Ici une passe `forEachSplat`
 * filtre les masqués ; le résultat est mis en cache par mesh et invalidé à chaque mutation du
 * masque (suppression, undo/redo, masque persisté appliqué au chargement).
 */
const cache = new WeakMap<SplatMesh, THREE.Box3 | null>();

/** À appeler après toute mutation d'opacité du packedSplats (cf. deleteSplats). */
export function invalidateVisibleBounds(mesh: SplatMesh): void {
  cache.delete(mesh);
}

/**
 * Bbox locale des splats visibles (clonée — les consommateurs la transforment en monde),
 * ou null si aucune donnée / aucun splat visible. Repli `getBoundingBox` si `forEachSplat`
 * est indisponible.
 */
export function visibleLocalBox(three: typeof THREE, mesh: SplatMesh): THREE.Box3 | null {
  if (cache.has(mesh)) {
    const hit = cache.get(mesh) ?? null;
    return hit ? hit.clone() : null;
  }
  let box: THREE.Box3 | null = null;
  try {
    const b = new three.Box3();
    mesh.forEachSplat((_index, center, _scales, _quat, opacity) => {
      if (opacity <= 0) return;
      b.expandByPoint(center);
    });
    box = b.isEmpty() ? null : b;
  } catch {
    box = null;
  }
  if (!box) {
    try {
      const fallback = mesh.getBoundingBox(true);
      box = fallback.isEmpty() ? null : fallback.clone();
    } catch {
      box = null;
    }
  }
  cache.set(mesh, box);
  return box ? box.clone() : null;
}
