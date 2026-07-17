import { useEffect, useRef } from 'react';
import type * as THREE from 'three';
import type { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { SplatViewer } from '../../useSplat';
import type { GizmoMode } from '../../../viewer/gizmos/useTransformGizmo';
import type { GizmoSettings } from '../../../viewer/gizmos/gizmoSettings';
import type { EditOp } from '../operations/history';
import {
  applySubsetDelta,
  restoreSubset,
  snapshotSubset,
  type SubsetSnapshot,
} from '../operations/transformSplats';

/** Applique espace/snaps/taille au TransformControls (réglages de la cible « splat »). */
function applySettings(control: TransformControls, s: GizmoSettings): void {
  control.setSpace(s.space);
  control.setTranslationSnap(s.translationSnap);
  control.setRotationSnap(s.rotationSnapDeg != null ? (s.rotationSnapDeg * Math.PI) / 180 : null);
  control.setScaleSnap(s.scaleSnap);
  control.size = s.size;
}

/**
 * Gizmo TRS d'un **sous-ensemble** de splats (Phase 28) : un objet proxy est placé au barycentre
 * de la sélection (enfant du SplatMesh), le `TransformControls` s'y attache, et chaque delta de
 * manipulation est appliqué aux seuls splats sélectionnés autour du pivot (`applySubsetDelta`).
 * Chaque drag est annulable (snapshot des valeurs d'origine). Actif quand une sélection existe et
 * qu'aucun volume n'est ciblé — sinon c'est le mesh entier / le volume qui prend le gizmo.
 */
export function useSubsetTransform(
  splat: SplatViewer,
  opts: {
    enabled: boolean;
    mode: GizmoMode;
    selected: ReadonlySet<number>;
    settings: GizmoSettings;
    pushHistory: (op: EditOp) => void;
    onChange: () => void;
  },
): void {
  const { enabled, mode, selected, settings, pushHistory, onChange } = opts;
  const { ready, getSceneHandle } = splat;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const cbRef = useRef({ pushHistory, onChange });
  cbRef.current = { pushHistory, onChange };
  const controlRef = useRef<TransformControls | null>(null);

  // `selected` (Set d'état de `useSelection`) ne change de référence qu'au vrai changement
  // d'ensemble → l'effet recrée alors le proxy/gizmo au nouveau barycentre.
  useEffect(() => {
    if (!enabled || !ready) return;
    const handle = getSceneHandle();
    if (!handle) return;
    const seed = snapshotSubset(handle, selected);
    if (!seed) return;
    const { THREE, scene, camera, controls, dom, mesh } = handle;
    const proxy = new THREE.Object3D();
    proxy.position.copy(seed.pivot);
    proxy.updateMatrix();
    mesh.add(proxy);

    let disposed = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const { TransformControls } = await import('three/addons/controls/TransformControls.js');
      if (disposed) {
        mesh.remove(proxy);
        return;
      }
      const control = new TransformControls(camera, dom);
      applySettings(control, settingsRef.current);
      control.setMode(modeRef.current);
      control.attach(proxy);
      const helper = control.getHelper();
      scene.add(helper);
      controlRef.current = control;

      let snap: SubsetSnapshot | null = null;
      let startInv: THREE.Matrix4 | null = null;
      let lastDelta: THREE.Matrix4 | null = null;

      const onDragging = (e: { value: unknown }) => {
        controls.enabled = !e.value; // gèle l'orbite pendant la manipulation
        if (e.value) {
          snap = snapshotSubset(handle, selected);
          proxy.updateMatrix();
          startInv = proxy.matrix.clone().invert();
          lastDelta = null;
        } else if (snap && lastDelta) {
          const s = snap;
          const d = lastDelta.clone();
          cbRef.current.pushHistory({
            label: 'Transformer la sélection',
            undo: () => restoreSubset(handle, s),
            redo: () => applySubsetDelta(handle, s, d),
          });
          // Recentre le proxy sur le nouveau barycentre, transform remise à l'identité.
          const after = snapshotSubset(handle, selected);
          proxy.position.copy(after ? after.pivot : proxy.position);
          proxy.rotation.set(0, 0, 0);
          proxy.scale.set(1, 1, 1);
          proxy.updateMatrix();
          snap = null;
          startInv = null;
          lastDelta = null;
        }
      };
      const onObjectChange = () => {
        if (!snap || !startInv) return;
        proxy.updateMatrix();
        const delta = proxy.matrix.clone().multiply(startInv); // local : M1 · M0⁻¹ (autour du pivot)
        applySubsetDelta(handle, snap, delta);
        lastDelta = delta;
        cbRef.current.onChange();
      };
      control.addEventListener('dragging-changed', onDragging as never);
      control.addEventListener('objectChange', onObjectChange);

      cleanup = () => {
        control.removeEventListener('dragging-changed', onDragging as never);
        control.removeEventListener('objectChange', onObjectChange);
        control.detach();
        scene.remove(helper);
        control.dispose();
        mesh.remove(proxy);
        controls.enabled = true;
        controlRef.current = null;
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
      mesh.remove(proxy);
    };
  }, [enabled, ready, getSceneHandle, selected]);

  useEffect(() => {
    controlRef.current?.setMode(mode);
  }, [mode]);
  useEffect(() => {
    if (controlRef.current) applySettings(controlRef.current, settings);
  }, [settings]);
}
