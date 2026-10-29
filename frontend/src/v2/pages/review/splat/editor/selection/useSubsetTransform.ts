// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, type RefObject } from 'react';
import type * as THREE from 'three';
import type { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { SplatViewer } from '../../useSplat';
import type { SubsetOp } from '../persistence/subsetOps';
import type { GizmoMode } from '@/v2/pages/review/viewer/gizmos/useTransformGizmo';
import type { GizmoSettings } from '@/v2/pages/review/viewer/gizmos/gizmoSettings';
import type { EditOp } from '../operations/history';
import { useT } from '@/v2/i18n';
import {
  applySubsetDelta,
  restoreSubset,
  snapshotSubset,
  type SubsetSnapshot,
} from '../operations/transformSplats';

/** Applies space, snaps and size to the TransformControls (settings of the "splat" target). */
function applySettings(control: TransformControls, s: GizmoSettings): void {
  control.setSpace(s.space);
  control.setTranslationSnap(s.translationSnap);
  control.setRotationSnap(s.rotationSnapDeg != null ? (s.rotationSnapDeg * Math.PI) / 180 : null);
  control.setScaleSnap(s.scaleSnap);
  control.size = s.size;
}

/**
 * TRS gizmo for a **subset** of splats (Phase 28): a proxy object is placed at the barycentre
 * of the selection (child of the SplatMesh), the `TransformControls` attaches to it, and each
 * manipulation delta is applied only to the selected splats around the pivot (`applySubsetDelta`).
 * Each drag is undoable (snapshot of the original values). Active when a selection exists and
 * no volume is targeted; otherwise the whole mesh or the volume takes the gizmo.
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
    /** Log of committed ops (Phase 28 persistence), kept in step with undo/redo. */
    opsRef: RefObject<SubsetOp[]>;
  },
): void {
  const t = useT();
  const { enabled, mode, selected, settings, pushHistory, onChange, opsRef } = opts;
  const { ready, getSceneHandle } = splat;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const cbRef = useRef({ pushHistory, onChange });
  cbRef.current = { pushHistory, onChange };
  const controlRef = useRef<TransformControls | null>(null);

  // `selected` (Set state of `useSelection`) only changes reference on a real change of the set,
  // so the effect recreates the proxy and gizmo at the new barycentre.
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
        controls.enabled = !e.value; // freezes the orbit during manipulation
        if (e.value) {
          snap = snapshotSubset(handle, selected);
          proxy.updateMatrix();
          startInv = proxy.matrix.clone().invert();
          lastDelta = null;
        } else if (snap && lastDelta) {
          const s = snap;
          const d = lastDelta.clone();
          // Persistence log (Phase 28): the op is recorded on commit and follows undo/redo.
          const record = { delta: [...d.elements], indices: [...s.indices] };
          opsRef.current.push(record);
          cbRef.current.pushHistory({
            label: t('splat.transformSelection'),
            undo: () => {
              restoreSubset(handle, s);
              const at = opsRef.current.indexOf(record);
              if (at >= 0) opsRef.current.splice(at, 1);
            },
            redo: () => {
              applySubsetDelta(handle, s, d);
              opsRef.current.push(record);
            },
          });
          // Recenters the proxy on the new barycentre, transform reset to identity.
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
        const delta = proxy.matrix.clone().multiply(startInv); // local: M1 · M0⁻¹ (around the pivot)
        applySubsetDelta(handle, snap, delta);
        lastDelta = delta;
        cbRef.current.onChange();
      };
      control.addEventListener('dragging-changed', onDragging);
      control.addEventListener('objectChange', onObjectChange);

      cleanup = () => {
        control.removeEventListener('dragging-changed', onDragging);
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
  }, [enabled, ready, getSceneHandle, selected, opsRef, t]);

  useEffect(() => {
    controlRef.current?.setMode(mode);
  }, [mode]);
  useEffect(() => {
    if (controlRef.current) applySettings(controlRef.current, settings);
  }, [settings]);
}
