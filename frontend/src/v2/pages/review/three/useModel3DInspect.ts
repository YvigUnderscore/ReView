import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyDisplayMode,
  createDisplayResources,
  type DisplayMode,
  type DisplayResources,
} from './displayModes';
import { collectModelStats, type ModelStats } from './modelStats';
import type { Model3DThreeState } from './useModel3DThree';

/**
 * Inspection du modèle 3D (Phase 39, 39.C) : modes d'affichage (shaded/wireframe/normales/matcap/
 * UV) appliqués en override **non destructif** sur la scène, et fiche technique (géométrie,
 * matériaux, UV, textures, extensions glTF) collectée à l'ouverture. Consomme `useModel3DThree`
 * via `getSceneHandle` (comme `useModel3DLighting`). Les ressources d'override sont construites
 * paresseusement et libérées au démontage.
 */
export function useModel3DInspect(model3d: Model3DThreeState) {
  const { ready, getSceneHandle, extensions } = model3d;
  const [mode, setModeState] = useState<DisplayMode>('shaded');
  const resRef = useRef<DisplayResources | null>(null);

  // Fiche technique : collectée une fois le modèle chargé (parcours lecture seule du root normalisé).
  // Mémoïsée sur `ready` — `setReady(true)` n'est émis qu'après l'affectation de la scène runtime.
  const stats = useMemo<ModelStats | null>(() => {
    if (!ready) return null;
    const handle = getSceneHandle();
    return handle?.mesh ? collectModelStats(handle.mesh) : null;
  }, [ready, getSceneHandle]);

  // Applique le mode courant (et le ré-applique quand le modèle vient d'être chargé).
  useEffect(() => {
    if (!ready) return;
    const handle = getSceneHandle();
    if (!handle?.mesh) return;
    if (!resRef.current) resRef.current = createDisplayResources(handle.THREE);
    applyDisplayMode(handle.mesh, mode, resRef.current);
  }, [ready, getSceneHandle, mode]);

  // Libération des matériaux/textures d'override au démontage.
  useEffect(
    () => () => {
      resRef.current?.dispose();
      resRef.current = null;
    },
    [],
  );

  const setMode = useCallback((m: DisplayMode) => setModeState(m), []);

  return { mode, setMode, stats, extensions };
}

export type Model3DInspectState = ReturnType<typeof useModel3DInspect>;
