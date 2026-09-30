// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useRef, useState, type RefObject } from 'react';
import { applyRoll } from './cameraRoll';
import { captureModelCamera, restoreModelCamera } from './modelCamera';
import { readViewState, sameViewState, type ReviewViewState } from './viewState';
import type { SceneRuntime } from './useModel3DThree';

/**
 * Fournisseur d'état de vue (mode d'affichage, plan de coupe, HDRI) enregistré par la review :
 * `captureCamera` l'agrège dans la vue jointe au commentaire, `restoreCamera` le rejoue.
 */
export interface ViewStateProvider {
  capture(): ReviewViewState;
  apply(state: ReviewViewState): void;
}

/**
 * Poignées caméra du viewer 3D : capture/restauration de la vue (`Comment.cameraState`,
 * session live, bookmarks), focale et tilt. Extrait de `useModel3DThree` (budget de lignes).
 *
 * La vue capturée emporte désormais l'**état de vue** — sans lui, un commentaire écrit en
 * wireframe, coupe ouverte ou sous un autre HDRI se rejouait avec la bonne caméra devant une
 * image différente. Le champ est optionnel : les commentaires antérieurs n'en portent pas, et
 * les consommateurs qui ne le connaissent pas (échantillonnage d'animation, bookmarks
 * persistés, dont le serveur écarte les champs inconnus) l'ignorent.
 */
export function useModelCameraHandles(params: {
  runtimeRef: RefObject<SceneRuntime | null>;
  threeRef: RefObject<typeof import('three') | null>;
}) {
  const { runtimeRef, threeRef } = params;
  const viewStateRef = useRef<ViewStateProvider | null>(null);
  const [fov, setFovState] = useState(45);
  const [roll, setRollState] = useState(0);

  const captureCamera = useCallback(() => {
    const rt = runtimeRef.current;
    const THREE = threeRef.current;
    if (!rt || !THREE) return undefined;
    const view = viewStateRef.current?.capture();
    const camera = captureModelCamera(THREE, rt.scene.camera, rt.scene.controls);
    return view ? { ...camera, view } : camera;
  }, [runtimeRef, threeRef]);

  const restoreCamera = useCallback(
    (state: unknown) => {
      const rt = runtimeRef.current;
      const THREE = threeRef.current;
      if (!rt || !THREE) return;
      restoreModelCamera(THREE, rt.scene.camera, rt.scene.controls, state);
      // L'état de vue n'est appliqué que s'il diffère de **ce qui est à l'écran** : la session
      // live rejoue la caméra de l'hôte plusieurs fois par seconde, et réappliquer l'HDRI à
      // chaque paquet relancerait son chargement en boucle. Comparer à l'état courant plutôt
      // qu'au dernier appliqué est ce qui permet de re-sélectionner un commentaire après avoir
      // changé de mode d'affichage à la main : sa vue est alors bien rejouée.
      const view = readViewState(state);
      if (!view) return;
      const provider = viewStateRef.current;
      if (!provider || sameViewState(view, provider.capture())) return;
      provider.apply(view);
    },
    [runtimeRef, threeRef],
  );

  /** Enregistre (ou retire) le fournisseur d'état de vue — appelé par la review une fois. */
  const registerViewState = useCallback((provider: ViewStateProvider | null) => {
    viewStateRef.current = provider;
  }, []);

  /** Focale (fov) — live (caméra principale). */
  const setFov = useCallback(
    (value: number) => {
      setFovState(value);
      const rt = runtimeRef.current;
      if (!rt) return;
      rt.scene.camera.fov = value;
      rt.scene.camera.updateProjectionMatrix();
    },
    [runtimeRef],
  );

  /** Tilt (roll) — oriente `camera.up` selon la direction de vue (mode layout). */
  const setRoll = useCallback(
    (value: number) => {
      setRollState(value);
      const rt = runtimeRef.current;
      const THREE = threeRef.current;
      if (!rt || !THREE) return;
      const forward = new THREE.Vector3().subVectors(rt.scene.controls.target, rt.scene.camera.position);
      applyRoll(THREE, rt.scene.camera, forward, value);
      rt.scene.controls.update();
    },
    [runtimeRef, threeRef],
  );

  return { captureCamera, restoreCamera, registerViewState, fov, setFov, roll, setRoll };
}
