import { useCallback, useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import type { SplatViewer } from '../../useSplat';
import { selectByShape } from './screenSelect';
import type { SelectCombine, SelectionShape } from './shapes2d';

/** Couleur de surbrillance de la sélection (orange DCC classique, lisible sur tout splat). */
const HIGHLIGHT_COLOR = 0xffaa33;

/**
 * Sélection par splat (10.G) : ensemble d'indices sélectionnés, alimenté par les formes
 * tracées à l'écran (rectangle/lasso, modificateurs Maj = ajouter / Alt = retirer), et
 * surbrillance 3D — un `THREE.Points` enfant du mesh (hérite du gizmo), rendu par-dessus
 * les splats (depthTest désactivé). La sélection persiste en changeant d'outil ; elle
 * alimente les opérations du chantier suivant (suppression).
 */
export function useSelection(splat: SplatViewer) {
  const { getSceneHandle } = splat;
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const highlightRef = useRef<THREE.Points | null>(null);

  const disposeHighlight = useCallback(() => {
    const pts = highlightRef.current;
    if (!pts) return;
    pts.geometry.dispose();
    (pts.material as THREE.Material).dispose();
    pts.removeFromParent();
    highlightRef.current = null;
  }, []);

  // Reconstruit la surbrillance à chaque changement de sélection (une passe forEachSplat).
  useEffect(() => {
    const handle = getSceneHandle();
    if (!handle) return;
    disposeHighlight();
    if (selected.size === 0) return;
    const { THREE, mesh } = handle;
    const positions: number[] = [];
    mesh.forEachSplat((index, center, _scales, _quat, opacity) => {
      if (opacity > 0 && selected.has(index)) positions.push(center.x, center.y, center.z);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      size: 2.5,
      sizeAttenuation: false,
      color: HIGHLIGHT_COLOR,
      depthTest: false,
    });
    const pts = new THREE.Points(geo, material);
    pts.renderOrder = 10; // au-dessus des splats
    mesh.add(pts);
    highlightRef.current = pts;
  }, [selected, getSceneHandle, disposeHighlight]);

  // Nettoyage au démontage de l'éditeur.
  useEffect(() => () => disposeHighlight(), [disposeHighlight]);

  /** Applique une forme tracée à l'écran (au lâcher du drag) à la sélection courante. */
  const commitShape = useCallback(
    (shape: SelectionShape, combine: SelectCombine, viewport: { width: number; height: number }) => {
      const handle = getSceneHandle();
      if (!handle) return;
      setSelected((prev) => selectByShape(handle, viewport, shape, prev, combine));
    },
    [getSceneHandle],
  );

  const clear = useCallback(() => setSelected(new Set()), []);

  return { selected, commitShape, clear };
}

export type SelectionState = ReturnType<typeof useSelection>;
