// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import type { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { ViewerSceneHandle } from '../../viewer/sceneHandle';
import type { LayoutModeState } from '../../viewer/useLayoutMode';
import { objectBoundingSphere } from '../../viewer/frameCamera';
import { registerSceneHelpers } from '../../viewer/sceneHelpers';
import { sampleAnimV2 } from '../channels/hermite';
import { gizmoKeyTime } from '../shotCamera';
import type { CameraAnimState } from '../useCameraAnim';
import { createCameraObject, type CameraObjectRuntime } from './cameraObject';
import { sampleTrajectory, trajSignature } from './trajectory';

const BASE_POSE = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };

/** Camera-object gizmo mode: move the pose or reorient the look. */
export type RigGizmoMode = 'translate' | 'rotate';

/**
 * Time (ms) at which a gizmo gesture writes its keys: that of the "primary" key (last of the
 * multi-selection) if the gesture takes one over, otherwise the playhead (rule: `gizmoKeyTime`).
 *
 * When it departs from the playhead, the gesture brings it there (see `onDragging`): the scene and
 * the PiP show the playback time, so a key edited at another instant did not visibly move.
 */
export function strokeTime(a: Pick<CameraAnimState, 'selection' | 'anim' | 'timeMs'>): number {
  const primary = a.selection[a.selection.length - 1];
  const selTime = primary ? a.anim.channels[primary.channel]?.keys[primary.index]?.t : undefined;
  return gizmoKeyTime(selTime, a.timeMs);
}

/**
 * Camera-object in the scene (Phase 17, layout mode): mounts the camera mesh + its trajectory into
 * the viewer's scene (splat or 3D), **syncs it to the animation** every frame, and — when editing —
 * attaches a `TransformControls` gizmo grafted onto the camera body or the target marker (raycast on
 * click). Moving the camera sets/overwrites a **position** key, moving the target sets a **target**
 * key, at the time of the selected key (otherwise at the playhead — auto-key).
 *
 * It is also **the sampler of the plan's pose outside playback**: mounted exactly when we are
 * outside the camera, it renders each frame the pose the animation describes and hands it back to
 * `layout.applyShot`, hence the PiP. The camera-object mesh and the PiP window therefore always
 * show the same thing.
 */
export function useCameraSceneRig(opts: {
  getSceneHandle: () => ViewerSceneHandle | null;
  subscribeFrame: (cb: (dt: number) => void) => () => void;
  ready: boolean;
  editable: boolean;
  anim: CameraAnimState;
  /**
   * The "in / out of camera" state (model at the top of `viewer/useLayoutMode`). A single
   * dependency, not three scattered callbacks: the rig exists **only** outside the camera, it starts
   * from the activation view, and it is the sampler of the plan's pose outside playback — otherwise
   * the PiP stayed frozen until the next scrub, although the gizmo, a curve, a tangent or an undo had
   * just changed the plan. During playback, it is the player that drives.
   */
  layout: Pick<LayoutModeState, 'layoutMode' | 'getActivationView' | 'applyShot'>;
}) {
  const { getSceneHandle, subscribeFrame, ready, editable, anim, layout } = opts;
  // Stable members (`useCallback`): the `layout` object, however, is new on every render — taking it
  // as an effect dependency would remount the camera-object and its gizmo on every render.
  const { layoutMode: active, getActivationView, applyShot } = layout;
  const objRef = useRef<CameraObjectRuntime | null>(null);
  const controlRef = useRef<TransformControls | null>(null);
  const [mode, setMode] = useState<RigGizmoMode>('translate');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  // "Latest value" copies read by the listeners/loops (avoids recreating the effects).
  const animRef = useRef(anim);
  animRef.current = anim;
  const trajKeyRef = useRef('');

  // Mounting the camera object + gizmo into the scene (layout mode active).
  useEffect(() => {
    if (!active || !ready) return;
    const handle = getSceneHandle();
    if (!handle) return;
    const { THREE, scene, camera, controls, dom, mesh } = handle;
    const radius = (mesh && objectBoundingSphere(THREE, mesh)?.radius) || 1;
    const obj = createCameraObject(THREE, scene, radius * 0.06);
    objRef.current = obj;

    let disposed = false;
    let cleanupGizmo: (() => void) | null = null;

    void (async () => {
      const { TransformControls } = await import('three/addons/controls/TransformControls.js');
      if (disposed) return;
      const control = new TransformControls(camera, dom);
      control.setMode('translate');
      control.enabled = editable;
      const helper = control.getHelper();
      scene.add(helper);
      // Helper object: the gizmo sits on the plan's camera, hence right in front of the lens —
      // left in the PiP pass, it would block the plan's view (see `viewer/sceneHelpers`).
      const unregisterHelper = registerSceneHelpers(helper);
      controlRef.current = control;

      // Current gizmo target: body (position/orientation) or marker (look target).
      let editing: 'body' | 'target' | null = null;
      // Look distance frozen at the start of a rotation (kept while reorienting the target).
      let rotateDist = 0;
      const fwd = new THREE.Vector3();
      const onDragging = (e: { value: unknown }) => {
        controls.enabled = !e.value; // freezes the orbit during manipulation
        if (!e.value) return;
        const a = animRef.current;
        a.beginStroke();
        // The playhead moves to the time the gesture will write. The scene and the PiP show
        // **the playback time**: taking over with the gizmo a key set at another instant did not
        // show — the camera-object snapped back every frame to the playhead's pose, and
        // the artist concluded the gizmo did nothing.
        const t = strokeTime(a);
        if (t !== Math.round(a.timeMs)) a.scrub(t);
        // Look distance read from the pose **sampled at that time**, not from the mesh:
        // the mesh only catches up with the new time on the next frame.
        const pose = sampleAnimV2(a.anim, t, getActivationView() ?? BASE_POSE);
        rotateDist =
          Math.hypot(
            pose.target.x - pose.position.x,
            pose.target.y - pose.position.y,
            pose.target.z - pose.position.z,
          ) || 1;
      };
      const onObjectChange = () => {
        const a = animRef.current;
        const t = strokeTime(a);
        if (editing === 'body' && modeRef.current === 'rotate') {
          // Body rotation → reorients the target (body +Z), look distance kept.
          const p = obj.body.position;
          fwd.set(0, 0, 1).applyQuaternion(obj.body.quaternion);
          a.strokeUpsertAt(t, {
            tx: p.x + fwd.x * rotateDist,
            ty: p.y + fwd.y * rotateDist,
            tz: p.z + fwd.z * rotateDist,
          });
        } else if (editing === 'body') {
          const p = obj.body.position;
          a.strokeUpsertAt(t, { px: p.x, py: p.y, pz: p.z });
        } else if (editing === 'target') {
          const p = obj.targetMarker.position;
          a.strokeUpsertAt(t, { tx: p.x, ty: p.y, tz: p.z });
        }
      };
      control.addEventListener('dragging-changed', onDragging);
      control.addEventListener('objectChange', onObjectChange);

      // Gizmo target selection on click (raycast on body / marker). The body takes the
      // current mode (translate/rotate); the target marker stays in translation.
      const raycaster = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      const onPointerDown = (ev: PointerEvent) => {
        if (!editable || ev.button !== 0 || control.dragging) return;
        const rect = dom.getBoundingClientRect();
        ndc.set(
          ((ev.clientX - rect.left) / rect.width) * 2 - 1,
          -((ev.clientY - rect.top) / rect.height) * 2 + 1,
        );
        raycaster.setFromCamera(ndc, camera);
        if (raycaster.intersectObject(obj.targetMarker, true).length) {
          editing = 'target';
          control.setMode('translate');
          control.attach(obj.targetMarker);
        } else if (raycaster.intersectObject(obj.body, true).length) {
          editing = 'body';
          control.setMode(modeRef.current);
          control.attach(obj.body);
        }
      };
      dom.addEventListener('pointerdown', onPointerDown);

      cleanupGizmo = () => {
        unregisterHelper();
        dom.removeEventListener('pointerdown', onPointerDown);
        control.removeEventListener('dragging-changed', onDragging);
        control.removeEventListener('objectChange', onObjectChange);
        control.detach();
        scene.remove(helper);
        control.dispose();
        controls.enabled = true;
        controlRef.current = null;
      };
    })();

    // Per-frame sync: the camera-object follows the animated pose + up-to-date trajectory.
    const offFrame = subscribeFrame(() => {
      const a = animRef.current;
      // Without a key, the camera-object sits on the layout's activation view (manipulable from the
      // first contact in edit) — unkeyed channels fall back there too.
      const base = getActivationView() ?? BASE_POSE;
      const pose = sampleAnimV2(a.anim, a.timeMs, base);
      obj.update(pose);
      obj.setVisible(a.hasAnimation || editable);
      // The PiP shows exactly the pose the camera-object carries — a single source.
      if (!a.playing) applyShot(pose);
      // Recomputes the trajectory only when the animation changes (all channels, see `trajectory`).
      const sig = trajSignature(a.anim);
      if (sig !== trajKeyRef.current) {
        trajKeyRef.current = sig;
        obj.setTrajectory(sampleTrajectory(a.anim, base));
      }
    });

    return () => {
      disposed = true;
      offFrame();
      cleanupGizmo?.();
      obj.dispose();
      objRef.current = null;
      trajKeyRef.current = '';
    };
  }, [active, ready, editable, getSceneHandle, subscribeFrame, getActivationView, applyShot]);

  // Applies the current mode to the gizmo when it is attached to the body (without reinstalling it).
  useEffect(() => {
    const c = controlRef.current;
    if (c && c.object === objRef.current?.body) c.setMode(mode);
  }, [mode]);

  return { mode, setMode };
}
