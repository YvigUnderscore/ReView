import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SceneViewer } from '../viewer/sceneHandle';
import { makeClipPlane, type SectionAxis } from './sectionPlane';

type Bounds = Record<SectionAxis, { min: number; max: number }>;

/**
 * Plan de coupe (section) du viewer 3D (39.D) : masque une moitié du modèle le long d'un axe, à une
 * position **scrubbable** (glisser/saisir dans le HUD → « draggable » à l'idiome de l'app), avec
 * inversion du côté conservé. **Session-local**, non destructif (`renderer.clippingPlanes`, restauré
 * à la désactivation). Les bornes de position viennent de la boîte englobante du modèle.
 */
export function useSectionPlane(viewer: SceneViewer) {
  const { ready, getSceneHandle } = viewer;
  const [active, setActive] = useState(false);
  const [axis, setAxisState] = useState<SectionAxis>('x');
  const [flip, setFlip] = useState(false);
  const [position, setPosition] = useState(0);

  // Boîte englobante du modèle → bornes de position par axe. Lecture seule (memo, pas d'effet).
  const bounds = useMemo<Bounds | null>(() => {
    if (!ready) return null;
    const h = getSceneHandle();
    if (!h?.mesh) return null;
    const box = new h.THREE.Box3().setFromObject(h.mesh);
    if (box.isEmpty()) return null;
    return {
      x: { min: box.min.x, max: box.max.x },
      y: { min: box.min.y, max: box.max.y },
      z: { min: box.min.z, max: box.max.z },
    };
  }, [ready, getSceneHandle]);

  // Applique/retire le plan de coupe (global renderer) selon l'état.
  useEffect(() => {
    const h = getSceneHandle();
    if (!h?.renderer) return;
    h.renderer.clippingPlanes = active ? [makeClipPlane(h.THREE, axis, position, flip)] : [];
    return () => {
      const hh = getSceneHandle();
      if (hh?.renderer) hh.renderer.clippingPlanes = [];
    };
  }, [ready, getSceneHandle, active, axis, position, flip]);

  const center = useCallback((a: SectionAxis, b: Bounds | null) => {
    const r = b?.[a];
    if (r) setPosition((r.min + r.max) / 2);
  }, []);

  const toggle = useCallback(() => {
    setActive((v) => {
      if (!v) center(axis, bounds); // recentre à l'activation
      return !v;
    });
  }, [axis, bounds, center]);

  const setAxis = useCallback(
    (a: SectionAxis) => {
      setAxisState(a);
      center(a, bounds);
    },
    [bounds, center],
  );

  const cur = bounds?.[axis] ?? { min: -1, max: 1 };
  return {
    active,
    toggle,
    axis,
    setAxis,
    position,
    setPosition,
    flip,
    toggleFlip: useCallback(() => setFlip((f) => !f), []),
    bounds: cur,
  };
}

export type SectionPlaneState = ReturnType<typeof useSectionPlane>;
