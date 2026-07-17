import { useCallback, useMemo, useRef, useState } from 'react';
import type { CameraController } from '../../camera/useCameraAnim';
import type { SplatViewer } from '../useSplat';

/**
 * Mode layout du viewer splat (Phase 27 — lot F, miroir de `useModelLayout` côté 3D) :
 * « in/out camera » + fenêtre flottante (PiP).
 * - **OFF** : le lecteur keyframe pilote la caméra principale (on est « dans » la caméra).
 * - **ON**  : la caméra principale est libre (« hors » caméra), le lecteur pilote la caméra
 *   layout du viewer, rendue dans le PiP (2ᵉ passe scissor dans `useSplat`). `layoutController`
 *   sert `useCameraAnim` (capture depuis la caméra libre, application sur la bonne caméra).
 */
export function useSplatLayout(splat: SplatViewer) {
  const { subscribeFrame, getDom, captureCamera, restoreCamera, restorePipCamera } = splat;
  const [layoutMode, setLayoutModeState] = useState(false);
  const layoutModeRef = useRef(false);

  const setLayoutMode = useCallback(
    (on: boolean) => {
      setLayoutModeState(on);
      layoutModeRef.current = on;
      // À l'activation : la caméra layout part de la vue courante (le PiP démarre cohérent).
      if (on) {
        const view = captureCamera();
        if (view) restorePipCamera(view);
      }
    },
    [captureCamera, restorePipCamera],
  );

  const restoreLayoutAware = useCallback(
    (state: unknown) => {
      if (layoutModeRef.current) restorePipCamera(state);
      else restoreCamera(state);
    },
    [restorePipCamera, restoreCamera],
  );

  const layoutController = useMemo<CameraController>(
    () => ({ subscribeFrame, getDom, captureCamera, restoreCamera: restoreLayoutAware }),
    [subscribeFrame, getDom, captureCamera, restoreLayoutAware],
  );

  return { layoutMode, setLayoutMode, layoutController };
}

export type SplatLayoutState = ReturnType<typeof useSplatLayout>;
