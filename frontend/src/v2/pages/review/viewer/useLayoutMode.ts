// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo, useRef, useState } from 'react';
import type { SplatCamera } from '../reviewTypes';
import type { CameraController } from '../camera/useCameraAnim';

/**
 * Cœur du mode layout, commun 3D/splat : « in/out camera » + fenêtre flottante (PiP).
 * - **OFF** : le lecteur keyframe pilote la caméra principale (on est « dans » la caméra).
 * - **ON**  : la caméra principale est libre (« hors » caméra), le lecteur pilote la caméra
 *   layout du viewer, rendue dans le PiP (2ᵉ passe scissor) — on voit le point de vue de la
 *   caméra tout en la déplaçant. `layoutController` sert `useCameraAnim` (capture depuis la
 *   caméra libre, application sur la bonne caméra selon le mode).
 *
 * La vue au moment de l'activation est retenue (`getActivationView`) : la caméra-objet du rig
 * s'y pose tant qu'aucune clé n'existe — sans elle, une animation vide échantillonnerait
 * l'origine et il n'y aurait rien à manipuler au premier contact.
 */
export function useLayoutMode(opts: {
  subscribeFrame: CameraController['subscribeFrame'];
  getDom: CameraController['getDom'];
  captureCamera: CameraController['captureCamera'];
  /** Applique une pose à la caméra principale (mode layout OFF). */
  restoreMain: (state: unknown) => void;
  /** Applique une pose à la caméra layout du PiP (mode layout ON). */
  restoreLayout: (state: unknown) => void;
}) {
  const { subscribeFrame, getDom, captureCamera, restoreMain, restoreLayout } = opts;
  const [layoutMode, setLayoutModeState] = useState(false);
  const layoutModeRef = useRef(false);
  const activationViewRef = useRef<SplatCamera | null>(null);

  const setLayoutMode = useCallback(
    (on: boolean) => {
      setLayoutModeState(on);
      layoutModeRef.current = on;
      // À l'activation : la caméra layout part de la vue courante (le PiP démarre cohérent).
      if (on) {
        const view = captureCamera();
        activationViewRef.current = (view as SplatCamera | undefined) ?? null;
        if (view) restoreLayout(view);
      }
    },
    [captureCamera, restoreLayout],
  );

  const restoreCamera = useCallback(
    (state: unknown) => {
      if (layoutModeRef.current) restoreLayout(state);
      else restoreMain(state);
    },
    [restoreLayout, restoreMain],
  );

  /** Vue capturée à l'activation du mode — pose de repli de la caméra-objet sans clé. */
  const getActivationView = useCallback(() => activationViewRef.current, []);

  const layoutController = useMemo<CameraController>(
    () => ({ subscribeFrame, getDom, captureCamera, restoreCamera }),
    [subscribeFrame, getDom, captureCamera, restoreCamera],
  );

  return { layoutMode, layoutModeRef, setLayoutMode, layoutController, getActivationView };
}

export type LayoutModeState = ReturnType<typeof useLayoutMode>;
