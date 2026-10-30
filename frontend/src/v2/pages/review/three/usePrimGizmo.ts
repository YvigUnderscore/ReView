// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import type * as THREE from 'three';
import type { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { SceneViewer } from '../viewer/sceneHandle';
import type { GizmoMode } from '../viewer/gizmos/useTransformGizmo';
import { objectsBoundingSphere } from '../viewer/frameCamera';
import { pivotedPose, type Pose, type Vec3 } from './primPivot';

/** Snapshot of a representative at the start of the drag — the deltas are relative to it, never accumulated. */
interface RepSnap {
  object: THREE.Object3D;
  base: Pose;
  pivot: Vec3;
  parentQuat: THREE.Quaternion;
  parentScale: THREE.Vector3;
}

/**
 * TRS gizmo of a USD prim selection (46.N, centered 46.Q, group B1): the `TransformControls` is
 * attached to a **proxy** placed at the common bounding center of the displayed objects — not to the
 * objects themselves, whose local origin is often at the world center (transforms baked into the
 * vertices by the Blender export).
 *
 * Each delta of the proxy (since the start of the drag) is converted into the parent space of **each
 * representative**, then applied around the common pivot (`pivotedPose`) — the prims rotate and scale
 * around the group's center, as in a DCC. On release, `onCommit` reads each one's pose — the override
 * deltas follow exactly (inverse of `planOverride`).
 */
export function usePrimGizmo(
  viewer: SceneViewer,
  opts: {
    enabled: boolean;
    mode: GizmoMode;
    /** One representative object per selected prim — each receives the gizmo's pose. */
    representatives: () => THREE.Object3D[];
    /** All displayed objects of the selection: their bounding center is the pivot. */
    targets: () => THREE.Object3D[];
    /** Changes when the selection changes — the gizmo is reinstalled on the new group. */
    selectionKey: string;
    onCommit: (objects: THREE.Object3D[]) => void;
    /**
     * Changes when the applied override changes (commit, cancel, revert, proposal): the proxy is then
     * re-placed at the center of the geometry. Without this, the gizmo stayed where the last drag had
     * left it — off-center, axes tilted by the rotations.
     */
    syncKey?: unknown;
  },
): void {
  const { enabled, mode, selectionKey, syncKey } = opts;
  const { ready, getSceneHandle } = viewer;
  const targetsRef = useRef(opts.targets);
  targetsRef.current = opts.targets;
  const repsRef = useRef(opts.representatives);
  repsRef.current = opts.representatives;
  const onCommitRef = useRef(opts.onCommit);
  onCommitRef.current = opts.onCommit;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const controlRef = useRef<TransformControls | null>(null);
  const syncRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled || !ready || !selectionKey) return;
    const handle = getSceneHandle();
    if (!handle) return;
    const { THREE: T, scene, camera, controls, dom } = handle;

    const bounds = objectsBoundingSphere(T, targetsRef.current());
    if (!bounds) return;

    let disposed = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const { TransformControls } = await import('three/addons/controls/TransformControls.js');
      if (disposed) return;

      const proxy = new T.Group();
      proxy.name = 'review-prim-gizmo-pivot';
      proxy.position.copy(bounds.center);
      scene.add(proxy);

      const control = new TransformControls(camera, dom);
      control.setMode(modeRef.current);
      control.attach(proxy);
      const helper = control.getHelper();
      scene.add(helper);

      // Re-places the proxy on the geometry after each override application (the object has just
      // moved without a drag) — never during a drag, when the proxy is the user's hand.
      syncRef.current = () => {
        if (control.dragging) return;
        const next = objectsBoundingSphere(T, targetsRef.current());
        if (next) proxy.position.copy(next.center);
        proxy.quaternion.identity();
        proxy.scale.set(1, 1, 1);
      };

      // Snapshot at the start of the drag: pose of each representative, common pivot expressed in
      // its parent frame — the proxy's deltas are measured against this state.
      let snap: {
        reps: RepSnap[];
        proxyStart: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 };
      } | null = null;

      const onDragging = (event: { value: unknown }) => {
        controls.enabled = !event.value;
        if (event.value) {
          const reps: RepSnap[] = [];
          for (const object of repsRef.current()) {
            const parent = object.parent;
            if (!parent) continue;
            parent.updateWorldMatrix(true, false);
            const pw = new T.Vector3();
            const qw = new T.Quaternion();
            const sw = new T.Vector3();
            parent.matrixWorld.decompose(pw, qw, sw);
            reps.push({
              object,
              base: {
                position: object.position.toArray(),
                quaternion: object.quaternion.toArray(),
                scale: object.scale.toArray(),
              },
              pivot: parent.worldToLocal(proxy.position.clone()).toArray(),
              parentQuat: qw,
              parentScale: sw,
            });
          }
          snap = reps.length
            ? {
                reps,
                proxyStart: {
                  position: proxy.position.clone(),
                  quaternion: proxy.quaternion.clone(),
                  scale: proxy.scale.clone(),
                },
              }
            : null;
        } else if (snap) {
          const objects = snap.reps.map((r) => r.object);
          snap = null;
          onCommitRef.current(objects);
        }
      };

      const onObjectChange = () => {
        if (!snap) return;
        for (const rep of snap.reps) {
          // Proxy delta in world space, then conversion into the representative's parent space.
          const invParent = rep.parentQuat.clone().invert();
          const tParent = proxy.position
            .clone()
            .sub(snap.proxyStart.position)
            .applyQuaternion(invParent)
            .divide(rep.parentScale);
          const qParent = invParent
            .clone()
            .multiply(proxy.quaternion.clone().multiply(snap.proxyStart.quaternion.clone().invert()))
            .multiply(rep.parentQuat);
          const sDelta = proxy.scale.clone().divide(snap.proxyStart.scale);

          const pose = pivotedPose(rep.base, rep.pivot, {
            t: tParent.toArray(),
            q: qParent.toArray(),
            s: sDelta.toArray(),
          });
          rep.object.position.set(...pose.position);
          rep.object.quaternion.set(...pose.quaternion);
          rep.object.scale.set(...pose.scale);
        }
      };

      control.addEventListener('dragging-changed', onDragging);
      control.addEventListener('objectChange', onObjectChange);
      controlRef.current = control;

      cleanup = () => {
        control.removeEventListener('dragging-changed', onDragging);
        control.removeEventListener('objectChange', onObjectChange);
        control.detach();
        scene.remove(helper);
        scene.remove(proxy);
        control.dispose();
        controls.enabled = true;
        controlRef.current = null;
        syncRef.current = null;
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [enabled, ready, getSceneHandle, selectionKey]);

  // Mode change without reinstalling the gizmo.
  useEffect(() => {
    controlRef.current?.setMode(mode);
  }, [mode]);

  // The override has just been reapplied (the `useUsdScene` effects run before these): the bounding
  // center may have moved, so the proxy follows.
  useEffect(() => {
    syncRef.current?.();
  }, [syncKey]);
}
