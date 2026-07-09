import { useCallback, useEffect, useRef, useState } from 'react';
import type { SplatViewer } from '../../useSplat';
import { createSelectionHighlight, type SelectionHighlight } from './highlight';
import { captureCenters, selectByShape } from './screenSelect';
import type { SelectCombine, SelectionShape } from './shapes2d';
import { selectByBrush } from './surfaceBrush';

/**
 * Sélection par splat (10.G, perf/lisibilité revues en V2) : ensemble d'indices sélectionnés,
 * alimenté par les formes tracées à l'écran (rectangle/lasso, Maj = ajouter / Alt = retirer).
 * Les centres sont mis en cache en `Float32Array` au premier commit (plus de passe
 * `forEachSplat` par sélection) et la surbrillance est une **teinte par index** injectée dans
 * le rendu Spark (`RgbaArray`) — nette par-dessus les gaussiennes, restaurée à la désélection.
 * `isHidden` exclut les splats masqués (suppression non-destructive) sans invalider le cache.
 */
export function useSelection(splat: SplatViewer, isHidden: (index: number) => boolean) {
  const { getSceneHandle } = splat;
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const centersRef = useRef<Float32Array | null>(null);
  const highlightRef = useRef<SelectionHighlight | null>(null);

  // Applique la teinte à chaque changement de sélection (création paresseuse : l'import Spark
  // est déjà en cache — le viewer l'a chargé — mais reste hors du bundle initial).
  useEffect(() => {
    if (selected.size === 0 && !highlightRef.current) return;
    const handle = getSceneHandle();
    if (!handle) return;
    let cancelled = false;
    void (async () => {
      if (!highlightRef.current) {
        const { RgbaArray } = await import('@sparkjsdev/spark');
        if (cancelled || highlightRef.current) return;
        highlightRef.current = createSelectionHighlight(handle, RgbaArray);
      }
      if (!cancelled) highlightRef.current.apply(selected);
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, getSceneHandle]);

  // Nettoyage au démontage de l'éditeur (détache l'override et libère la texture).
  useEffect(
    () => () => {
      highlightRef.current?.dispose();
      highlightRef.current = null;
      centersRef.current = null;
    },
    [],
  );

  /** Applique une forme tracée à l'écran (au lâcher du drag) à la sélection courante. */
  const commitShape = useCallback(
    (shape: SelectionShape, combine: SelectCombine, viewport: { width: number; height: number }) => {
      const handle = getSceneHandle();
      if (!handle) return;
      if (!centersRef.current) centersRef.current = captureCenters(handle.mesh);
      const centers = centersRef.current;
      setSelected((prev) => selectByShape(handle, centers, isHidden, viewport, shape, prev, combine));
    },
    [getSceneHandle, isHidden],
  );

  /** Coup de pinceau de surface (V3) : disque écran + bande de profondeur au point touché. */
  const commitBrush = useCallback(
    (
      point: { x: number; y: number },
      radiusPx: number,
      combine: SelectCombine,
      viewport: { width: number; height: number },
    ) => {
      const handle = getSceneHandle();
      if (!handle) return;
      if (!centersRef.current) centersRef.current = captureCenters(handle.mesh);
      const centers = centersRef.current;
      setSelected(
        (prev) => selectByBrush(handle, centers, isHidden, viewport, point, radiusPx, prev, combine) ?? prev,
      );
    },
    [getSceneHandle, isHidden],
  );

  /** Signale des indices (dé)masqués — la teinte resynchronise leur alpha au prochain apply. */
  const markDirty = useCallback((indices: Iterable<number>) => {
    highlightRef.current?.markDirty(indices);
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  return { selected, commitShape, commitBrush, clear, markDirty };
}

export type SelectionState = ReturnType<typeof useSelection>;
