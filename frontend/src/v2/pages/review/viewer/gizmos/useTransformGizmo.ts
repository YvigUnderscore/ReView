// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import type * as THREE from 'three';
import type { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { SplatTransform } from '../../reviewTypes';
import type { SceneViewer } from '../sceneHandle';
import { DEFAULT_GIZMO_SETTINGS, type GizmoSettings } from './gizmoSettings';
import { readMeshTransform } from './meshTransform';

/** Mode du gizmo de transformation, calqué sur les DCC 3D (déplacer / tourner / mettre à l'échelle). */
export type GizmoMode = 'translate' | 'rotate' | 'scale';

/** Applique espace/snaps/taille au TransformControls (réglages par cible, 11.G). */
function applyGizmoSettings(control: TransformControls, s: GizmoSettings): void {
  control.setSpace(s.space);
  control.setTranslationSnap(s.translationSnap);
  control.setRotationSnap(s.rotationSnapDeg != null ? (s.rotationSnapDeg * Math.PI) / 180 : null);
  control.setScaleSnap(s.scaleSnap);
  control.size = s.size;
}

/**
 * Gizmo de transformation 3D (10.G, généralisé Phase 17) : greffe un `TransformControls`
 * (three addons) sur l'objet principal du viewer (`handle.mesh` : SplatMesh ou root du modèle
 * 3D) — ou sur `target` (ex. SDF d'un volume de crop) s'il est fourni — via la poignée de scène
 * commune (`SceneViewer`). Le gizmo est **visible dans la scène** (plus de sliders en menu) ;
 * l'orbite est gelée pendant un drag, et chaque changement remonte la TRS de l'objet manipulé
 * via `onChange`. Import dynamique pour rester hors du bundle initial. Toute la logique Three
 * vit ici, pas dans les composants.
 */
export function useTransformGizmo(
  viewer: SceneViewer,
  opts: {
    enabled: boolean;
    mode: GizmoMode;
    /** Cible du gizmo (par défaut : `handle.mesh` — SplatMesh ou root du modèle). */
    target?: THREE.Object3D | null;
    /** Réglages espace/snap/taille par cible (11.G) — défauts « splat » si absent. */
    settings?: GizmoSettings;
    onChange: (t: SplatTransform) => void;
    /** Fin de manipulation (Phase 26) : TRS avant/après le drag → opération annulable. */
    onCommit?: (before: SplatTransform, after: SplatTransform) => void;
  },
): void {
  const { enabled, mode, target } = opts;
  const settings = opts.settings ?? DEFAULT_GIZMO_SETTINGS.splat;
  const { ready, getSceneHandle } = viewer;
  const onChangeRef = useRef(opts.onChange);
  onChangeRef.current = opts.onChange;
  const onCommitRef = useRef(opts.onCommit);
  onCommitRef.current = opts.onCommit;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const controlRef = useRef<TransformControls | null>(null);

  useEffect(() => {
    if (!enabled || !ready) return;
    const handle = getSceneHandle();
    if (!handle) return;
    const { scene, camera, controls, mesh, dom } = handle;
    const attached = target ?? mesh;
    if (!attached) return;

    let disposed = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const { TransformControls } = await import('three/addons/controls/TransformControls.js');
      if (disposed) return;
      const control = new TransformControls(camera, dom);
      applyGizmoSettings(control, settingsRef.current); // réglages courants (effet dédié ci-dessous)
      control.setMode(modeRef.current); // mode courant sans dépendance d'effet (voir effet ci-dessous)
      control.attach(attached);
      const helper = control.getHelper();
      scene.add(helper);

      let dragStart: SplatTransform | null = null;
      const onDragging = (event: { value: unknown }) => {
        controls.enabled = !event.value; // gèle l'orbite pendant la manipulation du gizmo
        if (event.value) {
          dragStart = readMeshTransform(attached); // début de drag : snapshot pour l'historique
        } else if (dragStart) {
          onCommitRef.current?.(dragStart, readMeshTransform(attached));
          dragStart = null;
        }
      };
      const onObjectChange = () => onChangeRef.current(readMeshTransform(attached));
      control.addEventListener('dragging-changed', onDragging);
      control.addEventListener('objectChange', onObjectChange);
      controlRef.current = control;

      cleanup = () => {
        control.removeEventListener('dragging-changed', onDragging);
        control.removeEventListener('objectChange', onObjectChange);
        control.detach();
        scene.remove(helper);
        control.dispose();
        controls.enabled = true;
        controlRef.current = null;
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [enabled, ready, getSceneHandle, target]);

  // Changement de mode sans réinstaller le gizmo.
  useEffect(() => {
    controlRef.current?.setMode(mode);
  }, [mode]);

  // Changement de réglages (espace/snap/taille) à chaud, sans réinstaller le gizmo (11.G).
  useEffect(() => {
    if (controlRef.current) applyGizmoSettings(controlRef.current, settings);
  }, [settings]);
}
