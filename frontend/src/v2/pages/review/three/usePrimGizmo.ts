import { useEffect, useRef } from 'react';
import type * as THREE from 'three';
import type { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { SceneViewer } from '../viewer/sceneHandle';
import type { GizmoMode } from '../viewer/gizmos/useTransformGizmo';
import { objectsBoundingSphere } from '../viewer/frameCamera';
import { pivotedPose, type Pose, type Quat, type Vec3 } from './primPivot';

/**
 * Gizmo TRS d'un prim USD (46.N, centré 46.Q) : le `TransformControls` est attaché à un
 * **proxy** posé au centre englobant des objets affichés du prim — pas à l'objet lui-même,
 * dont l'origine locale est souvent au centre du monde (transformations cuites dans les
 * sommets par l'export Blender), ce qui plantait le gizmo au milieu de la scène.
 *
 * Chaque delta du proxy (depuis le début du drag) est converti dans l'espace parent de
 * l'objet puis appliqué **autour du pivot** (`pivotedPose`). Au lâcher, `onCommit` relève la
 * pose de l'objet — le delta d'override en découle exactement (inverse de `planOverride`).
 */
export function usePrimGizmo(
  viewer: SceneViewer,
  opts: {
    enabled: boolean;
    mode: GizmoMode;
    /** Objet du prim qui reçoit la pose — les autres suivent via l'override au commit. */
    target: THREE.Object3D | null;
    /** Objets affichés du prim : leur centre englobant est le pivot du gizmo. */
    targets: () => THREE.Object3D[];
    onCommit: (object: THREE.Object3D) => void;
  },
): void {
  const { enabled, mode, target } = opts;
  const { ready, getSceneHandle } = viewer;
  const targetsRef = useRef(opts.targets);
  targetsRef.current = opts.targets;
  const onCommitRef = useRef(opts.onCommit);
  onCommitRef.current = opts.onCommit;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const controlRef = useRef<TransformControls | null>(null);

  useEffect(() => {
    if (!enabled || !ready || !target) return;
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

      // Instantané au début du drag : pose de l'objet, pivot et repère parent — les deltas du
      // proxy sont mesurés par rapport à cet état, jamais cumulés.
      let snap: {
        base: Pose;
        pivot: Vec3;
        parentQuat: THREE.Quaternion;
        parentScale: THREE.Vector3;
        proxyStart: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 };
      } | null = null;

      const onDragging = (event: { value: unknown }) => {
        controls.enabled = !event.value;
        if (event.value) {
          const parent = target.parent;
          if (!parent) return;
          parent.updateWorldMatrix(true, false);
          const pw = new T.Vector3();
          const qw = new T.Quaternion();
          const sw = new T.Vector3();
          parent.matrixWorld.decompose(pw, qw, sw);
          snap = {
            base: {
              position: target.position.toArray() as Vec3,
              quaternion: target.quaternion.toArray() as Quat,
              scale: target.scale.toArray() as Vec3,
            },
            pivot: parent.worldToLocal(proxy.position.clone()).toArray() as Vec3,
            parentQuat: qw,
            parentScale: sw,
            proxyStart: {
              position: proxy.position.clone(),
              quaternion: proxy.quaternion.clone(),
              scale: proxy.scale.clone(),
            },
          };
        } else if (snap) {
          snap = null;
          onCommitRef.current(target);
        }
      };

      const onObjectChange = () => {
        if (!snap) return;
        // Delta du proxy en espace monde, puis conversion dans l'espace parent de l'objet.
        const invParent = snap.parentQuat.clone().invert();
        const tParent = proxy.position
          .clone()
          .sub(snap.proxyStart.position)
          .applyQuaternion(invParent)
          .divide(snap.parentScale);
        const qParent = invParent
          .clone()
          .multiply(proxy.quaternion.clone().multiply(snap.proxyStart.quaternion.clone().invert()))
          .multiply(snap.parentQuat);
        const sDelta = proxy.scale.clone().divide(snap.proxyStart.scale);

        const pose = pivotedPose(snap.base, snap.pivot, {
          t: tParent.toArray() as Vec3,
          q: qParent.toArray() as Quat,
          s: sDelta.toArray() as Vec3,
        });
        target.position.set(...pose.position);
        target.quaternion.set(...pose.quaternion);
        target.scale.set(...pose.scale);
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
}
