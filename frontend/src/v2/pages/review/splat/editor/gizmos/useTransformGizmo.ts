import { useEffect, useRef } from 'react';
import type * as THREE from 'three';
import type { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { SplatTransform } from '../../../reviewTypes';
import type { SplatViewer } from '../../useSplat';
import { readMeshTransform } from './meshTransform';

/** Mode du gizmo de transformation, calqué sur les DCC 3D (déplacer / tourner / mettre à l'échelle). */
export type GizmoMode = 'translate' | 'rotate' | 'scale';

/**
 * Gizmo de transformation 3D (10.G) : greffe un `TransformControls` (three addons) sur le
 * `SplatMesh` via la poignée de scène exposée par `useSplat`. Le gizmo est **visible dans la
 * scène** (plus de sliders en menu) ; l'orbite est gelée pendant un drag, et chaque changement
 * remonte la TRS via `onChange` (pour l'aperçu d'état et la sauvegarde). Import dynamique pour
 * rester hors du bundle initial. Toute la logique Three vit ici, pas dans les composants.
 */
export function useTransformGizmo(
  splat: SplatViewer,
  opts: { enabled: boolean; mode: GizmoMode; onChange: (t: SplatTransform) => void },
): void {
  const { enabled, mode } = opts;
  const { ready, getSceneHandle } = splat;
  const onChangeRef = useRef(opts.onChange);
  onChangeRef.current = opts.onChange;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const controlRef = useRef<TransformControls | null>(null);

  useEffect(() => {
    if (!enabled || !ready) return;
    const handle = getSceneHandle();
    if (!handle) return;
    const { scene, camera, controls, mesh, dom } = handle;

    let disposed = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const { TransformControls } = await import('three/addons/controls/TransformControls.js');
      if (disposed) return;
      const control = new TransformControls(camera, dom);
      control.setSpace('local');
      control.setMode(modeRef.current); // mode courant sans dépendance d'effet (voir effet ci-dessous)
      control.attach(mesh as unknown as THREE.Object3D);
      const helper = control.getHelper();
      scene.add(helper);

      const onDragging = (event: { value: unknown }) => {
        controls.enabled = !event.value; // gèle l'orbite pendant la manipulation du gizmo
      };
      const onObjectChange = () => onChangeRef.current(readMeshTransform(mesh));
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
  }, [enabled, ready, getSceneHandle]);

  // Changement de mode sans réinstaller le gizmo.
  useEffect(() => {
    controlRef.current?.setMode(mode);
  }, [mode]);
}
