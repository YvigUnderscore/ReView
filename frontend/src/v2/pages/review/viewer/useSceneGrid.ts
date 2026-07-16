import { useCallback, useEffect, useState } from 'react';
import type { Material } from 'three';
import type { SceneViewer } from './sceneHandle';

const STORAGE_KEY = 'review-grid-visible';

/**
 * Grille de sol des viewers 3D/splat : repère d'orientation de la scène (plan Y=0),
 * togglable depuis le HUD, préférence persistée en localStorage. Un seul code pour les
 * deux viewers via la poignée commune `SceneViewer` (Phase 17).
 */
export function useSceneGrid(viewer: SceneViewer): { visible: boolean; toggle: () => void } {
  const [visible, setVisible] = useState(() => localStorage.getItem(STORAGE_KEY) !== '0');
  const { ready, getSceneHandle } = viewer;

  useEffect(() => {
    const h = getSceneHandle();
    if (!ready || !h || !visible) return;
    const grid = new h.THREE.GridHelper(20, 40, 0x8888aa, 0x444455);
    const mat = grid.material as Material;
    mat.transparent = true;
    mat.opacity = 0.25;
    mat.depthWrite = false;
    h.scene.add(grid);
    return () => {
      h.scene.remove(grid);
      grid.dispose();
    };
  }, [ready, getSceneHandle, visible]);

  const toggle = useCallback(() => {
    setVisible((v) => {
      localStorage.setItem(STORAGE_KEY, v ? '0' : '1');
      return !v;
    });
  }, []);

  return { visible, toggle };
}
