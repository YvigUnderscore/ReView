// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SceneViewer } from '../viewer/sceneHandle';
import { turntableStep, type TurntableAxis } from './turntable';

/** Contrôleur d'abonnement à la boucle de rendu (fourni par `useModel3DThree`). */
interface FrameSource {
  subscribeFrame: (cb: (dt: number) => void) => () => void;
}

/**
 * Turntable paramétrable (39.D) : fait tourner la vue automatiquement autour de la cible (axe X/Y/Z,
 * vitesse en °/s). **Session-local** — prévisualisation d'inspection non persistée, non destructive
 * (n'altère ni le modèle ni la présentation). S'abonne à la boucle de rendu tant qu'il est actif.
 */
export function useTurntable(viewer: SceneViewer & FrameSource) {
  const { ready, getSceneHandle, subscribeFrame } = viewer;
  const [active, setActive] = useState(false);
  const [axis, setAxis] = useState<TurntableAxis>('y');
  const [speed, setSpeed] = useState(30); // °/s
  // Lu dans la boucle sans relancer l'abonnement à chaque changement de vitesse/axe.
  const cfg = useRef({ axis, speed });
  useEffect(() => {
    cfg.current = { axis, speed };
  }, [axis, speed]);

  useEffect(() => {
    if (!ready || !active) return;
    return subscribeFrame((dt) => {
      const h = getSceneHandle();
      if (!h) return;
      const delta = ((cfg.current.speed * Math.PI) / 180) * dt;
      turntableStep(h.THREE, h.camera, h.controls, cfg.current.axis, delta);
    });
  }, [ready, active, getSceneHandle, subscribeFrame]);

  const toggle = useCallback(() => setActive((v) => !v), []);
  return { active, toggle, axis, setAxis, speed, setSpeed };
}

export type TurntableState = ReturnType<typeof useTurntable>;
