import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import type * as THREE from 'three';
import type { SplatCamera } from '../reviewTypes';
import type { CameraController } from '../splat/camera/useCameraKeyframes';
import type { ModelScene } from './createModelScene';
import { applyPoseToCamera } from './applyPose';
import { captureModelCamera, restoreModelCamera } from './modelCamera';

/** Rectangle du PiP (caméra layout), coin bas-droit — coords GL (y depuis le bas), CSS pixels. */
export function pipRect(
  w: number,
  h: number,
  frac = 0.28,
  margin = 10,
  aspect = 16 / 9,
): { x: number; y: number; w: number; h: number } {
  const pw = Math.max(1, Math.round(Math.min(w * frac, w - 2 * margin)));
  const ph = Math.max(1, Math.min(Math.round(pw / aspect), h - 2 * margin));
  return { x: Math.max(margin, w - pw - margin), y: margin, w: pw, h: ph };
}

interface LayoutRuntime {
  scene: ModelScene;
  layoutCam: THREE.PerspectiveCamera;
}

/**
 * Mode layout du viewer 3D (Phase 15/16) : « in/out camera » + fenêtre flottante (PiP).
 * - **OFF** : le lecteur keyframe pilote la caméra principale (on est « dans » la caméra).
 * - **ON**  : la caméra principale est libre (« hors » caméra), le lecteur pilote une caméra
 *   layout distincte, rendue dans un PiP (2ᵉ passe scissor) — on voit le point de vue de la
 *   caméra tout en la déplaçant. `layoutController` sert `useCameraKeyframes` (capture depuis la
 *   caméra libre, application sur la bonne caméra selon le mode).
 */
export function useModelLayout(opts: {
  runtimeRef: RefObject<LayoutRuntime | null>;
  threeRef: RefObject<typeof import('three') | null>;
  subscribeFrame: CameraController['subscribeFrame'];
  getDom: CameraController['getDom'];
  captureCamera: CameraController['captureCamera'];
}) {
  const { runtimeRef, threeRef, subscribeFrame, getDom, captureCamera } = opts;
  const [layoutMode, setLayoutModeState] = useState(false);
  const layoutModeRef = useRef(false);

  const setLayoutMode = useCallback(
    (on: boolean) => {
      setLayoutModeState(on);
      layoutModeRef.current = on;
      const rt = runtimeRef.current;
      const THREE = threeRef.current;
      // À l'activation : la caméra layout part de la vue courante (le PiP démarre cohérent).
      if (on && rt && THREE) {
        applyPoseToCamera(THREE, rt.layoutCam, captureModelCamera(THREE, rt.scene.camera, rt.scene.controls));
      }
    },
    [runtimeRef, threeRef],
  );

  const restoreCamera = useCallback(
    (state: unknown) => {
      const rt = runtimeRef.current;
      const THREE = threeRef.current;
      if (!rt || !THREE) return;
      if (layoutModeRef.current) applyPoseToCamera(THREE, rt.layoutCam, state as SplatCamera);
      else restoreModelCamera(THREE, rt.scene.camera, rt.scene.controls, state);
    },
    [runtimeRef, threeRef],
  );

  const layoutController = useMemo<CameraController>(
    () => ({ subscribeFrame, getDom, captureCamera, restoreCamera }),
    [subscribeFrame, getDom, captureCamera, restoreCamera],
  );

  /** 2ᵉ passe de rendu : le PiP de la caméra layout (appelé par la boucle du viewer). */
  const renderPip = useCallback(() => {
    if (!layoutModeRef.current) return;
    const rt = runtimeRef.current;
    if (!rt) return;
    const r = rt.scene.renderer;
    const dom = r.domElement;
    const w = dom.clientWidth;
    const h = dom.clientHeight;
    if (w <= 0 || h <= 0) return;
    const rect = pipRect(w, h);
    rt.layoutCam.aspect = rect.w / rect.h;
    rt.layoutCam.updateProjectionMatrix();
    r.setScissorTest(true);
    r.setScissor(rect.x, rect.y, rect.w, rect.h);
    r.setViewport(rect.x, rect.y, rect.w, rect.h);
    r.autoClear = false;
    r.clearDepth(); // scissor actif → n'efface la profondeur que dans le PiP
    r.render(rt.scene.scene, rt.layoutCam);
    r.autoClear = true;
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
  }, [runtimeRef]);

  return { layoutMode, setLayoutMode, layoutController, renderPip };
}
