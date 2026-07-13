import { useEffect, useRef } from 'react';
import type { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { ViewerSceneHandle } from '../../viewer/sceneHandle';
import { objectBoundingSphere } from '../../viewer/frameCamera';
import { sampleAnimV2 } from '../channels/hermite';
import { animKeyTimes, type CameraAnimV2 } from '../channels/model';
import type { CameraAnimState } from '../useCameraAnim';
import { createCameraObject, type CameraObjectRuntime } from './cameraObject';

const BASE_POSE = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };

/**
 * Caméra-objet dans la scène (Phase 17, mode layout) : monte le mesh caméra + sa trajectoire dans
 * la scène du viewer (splat ou 3D), le **synchronise à l'animation** chaque frame, et — en édition
 * — attache un gizmo `TransformControls` que l'on greffe au corps de la caméra ou au marqueur de
 * cible (raycast au clic). Déplacer la caméra pose/écrase une clé **position**, déplacer la cible
 * pose une clé **cible**, au temps de la clé sélectionnée (sinon au playhead — auto-key).
 */
export function useCameraSceneRig(opts: {
  getSceneHandle: () => ViewerSceneHandle | null;
  subscribeFrame: (cb: (dt: number) => void) => () => void;
  ready: boolean;
  active: boolean;
  editable: boolean;
  anim: CameraAnimState;
}) {
  const { getSceneHandle, subscribeFrame, ready, active, editable, anim } = opts;
  const objRef = useRef<CameraObjectRuntime | null>(null);
  const controlRef = useRef<TransformControls | null>(null);
  // Copies « dernière valeur » lues par les listeners/boucles (évite de recréer les effets).
  const animRef = useRef(anim);
  animRef.current = anim;
  const trajKeyRef = useRef('');

  // Montage de l'objet caméra + gizmo dans la scène (mode layout actif).
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
      controlRef.current = control;

      // Cible courante du gizmo : corps (position) ou marqueur (cible du regard).
      let editing: 'body' | 'target' | null = null;
      const onDragging = (e: { value: unknown }) => {
        controls.enabled = !e.value; // gèle l'orbite pendant la manipulation
        if (e.value) animRef.current.beginStroke();
      };
      const onObjectChange = () => {
        const a = animRef.current;
        const times = animKeyTimes(a.anim);
        const selTime = a.selection
          ? a.anim.channels[a.selection.channel]?.keys[a.selection.index]?.t
          : undefined;
        const t = selTime ?? (times.length ? a.timeMs : 0);
        if (editing === 'body') {
          const p = obj.body.position;
          a.strokeUpsertAt(t, { px: p.x, py: p.y, pz: p.z });
        } else if (editing === 'target') {
          const p = obj.targetMarker.position;
          a.strokeUpsertAt(t, { tx: p.x, ty: p.y, tz: p.z });
        }
      };
      control.addEventListener('dragging-changed', onDragging as never);
      control.addEventListener('objectChange', onObjectChange);

      // Sélection de la cible du gizmo au clic (raycast sur corps / marqueur).
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
          control.attach(obj.targetMarker);
        } else if (raycaster.intersectObject(obj.body, true).length) {
          editing = 'body';
          control.attach(obj.body);
        }
      };
      dom.addEventListener('pointerdown', onPointerDown);

      cleanupGizmo = () => {
        dom.removeEventListener('pointerdown', onPointerDown);
        control.removeEventListener('dragging-changed', onDragging as never);
        control.removeEventListener('objectChange', onObjectChange);
        control.detach();
        scene.remove(helper);
        control.dispose();
        controls.enabled = true;
        controlRef.current = null;
      };
    })();

    // Synchronisation par frame : la caméra-objet suit la pose animée + trajectoire à jour.
    const offFrame = subscribeFrame(() => {
      const a = animRef.current;
      const pose = sampleAnimV2(a.anim, a.timeMs, BASE_POSE);
      obj.update(pose);
      const has = a.hasAnimation;
      obj.setVisible(has);
      // Recalcule la trajectoire seulement quand l'animation change (clé signée par temps+valeurs).
      const sig = trajSignature(a.anim);
      if (sig !== trajKeyRef.current) {
        trajKeyRef.current = sig;
        obj.setTrajectory(sampleTrajectory(a.anim));
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
  }, [active, ready, editable, getSceneHandle, subscribeFrame]);
}

/** Signature légère de l'animation (temps+valeurs px) pour ne recalculer la trajectoire qu'au besoin. */
function trajSignature(anim: CameraAnimV2): string {
  const k = anim.channels.px?.keys ?? [];
  return `${animKeyTimes(anim).length}:${k.map((x) => `${x.t},${x.v.toFixed(2)}`).join('|')}`;
}

/** Échantillonne la trajectoire (positions) sur toute la durée pour tracer la polyligne. */
function sampleTrajectory(anim: CameraAnimV2): Array<{ x: number; y: number; z: number }> {
  const times = animKeyTimes(anim);
  if (times.length < 2) return [];
  const duration = times[times.length - 1];
  const out: Array<{ x: number; y: number; z: number }> = [];
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const pose = sampleAnimV2(anim, (i / steps) * duration, BASE_POSE);
    out.push(pose.position);
  }
  return out;
}
