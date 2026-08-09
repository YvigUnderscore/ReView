// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import type * as THREE from 'three';
import type { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { SceneViewer } from '../viewer/sceneHandle';
import type { GizmoMode } from '../viewer/gizmos/useTransformGizmo';
import { objectsBoundingSphere } from '../viewer/frameCamera';
import { pivotedPose, type Pose, type Quat, type Vec3 } from './primPivot';

/** Instantané d'un représentant au début du drag — les deltas s'y rapportent, jamais cumulés. */
interface RepSnap {
  object: THREE.Object3D;
  base: Pose;
  pivot: Vec3;
  parentQuat: THREE.Quaternion;
  parentScale: THREE.Vector3;
}

/**
 * Gizmo TRS d'une sélection de prims USD (46.N, centré 46.Q, groupe B1) : le `TransformControls`
 * est attaché à un **proxy** posé au centre englobant commun des objets affichés — pas aux
 * objets eux-mêmes, dont l'origine locale est souvent au centre du monde (transformations
 * cuites dans les sommets par l'export Blender).
 *
 * Chaque delta du proxy (depuis le début du drag) est converti dans l'espace parent de **chaque
 * représentant** puis appliqué autour du pivot commun (`pivotedPose`) — les prims tournent et
 * s'échelonnent autour du centre du groupe, comme dans un DCC. Au lâcher, `onCommit` relève la
 * pose de chacun — les deltas d'override en découlent exactement (inverse de `planOverride`).
 */
export function usePrimGizmo(
  viewer: SceneViewer,
  opts: {
    enabled: boolean;
    mode: GizmoMode;
    /** Un objet représentatif par prim sélectionné — chacun reçoit la pose du gizmo. */
    representatives: () => THREE.Object3D[];
    /** Tous les objets affichés de la sélection : leur centre englobant est le pivot. */
    targets: () => THREE.Object3D[];
    /** Change quand la sélection change — le gizmo est réinstallé sur le nouveau groupe. */
    selectionKey: string;
    onCommit: (objects: THREE.Object3D[]) => void;
    /**
     * Change quand l'override appliqué change (commit, annulation, revert, proposition) : le
     * proxy est alors reposé au centre de la géométrie. Sans cela, le gizmo restait là où le
     * dernier drag l'avait laissé — centre désaligné, axes inclinés par les rotations.
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

      // Repose le proxy sur la géométrie après chaque application d'override (l'objet vient
      // de bouger sans drag) — jamais pendant un drag, où le proxy est la main de l'utilisateur.
      syncRef.current = () => {
        if (control.dragging) return;
        const next = objectsBoundingSphere(T, targetsRef.current());
        if (next) proxy.position.copy(next.center);
        proxy.quaternion.identity();
        proxy.scale.set(1, 1, 1);
      };

      // Instantané au début du drag : pose de chaque représentant, pivot commun exprimé dans
      // son repère parent — les deltas du proxy sont mesurés par rapport à cet état.
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
                position: object.position.toArray() as Vec3,
                quaternion: object.quaternion.toArray() as Quat,
                scale: object.scale.toArray() as Vec3,
              },
              pivot: parent.worldToLocal(proxy.position.clone()).toArray() as Vec3,
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
          // Delta du proxy en espace monde, puis conversion dans l'espace parent du représentant.
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
            t: tParent.toArray() as Vec3,
            q: qParent.toArray() as Quat,
            s: sDelta.toArray() as Vec3,
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

  // Changement de mode sans réinstaller le gizmo.
  useEffect(() => {
    controlRef.current?.setMode(mode);
  }, [mode]);

  // L'override vient d'être réappliqué (les effets de `useUsdScene` passent avant ceux-ci) :
  // le centre englobant a pu bouger, le proxy suit.
  useEffect(() => {
    syncRef.current?.();
  }, [syncKey]);
}
