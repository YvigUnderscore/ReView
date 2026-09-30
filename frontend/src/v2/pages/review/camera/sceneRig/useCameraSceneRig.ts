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

/** Mode du gizmo de la caméra-objet : déplacer la pose ou réorienter le regard. */
export type RigGizmoMode = 'translate' | 'rotate';

/**
 * Temps (ms) auquel un geste de gizmo écrit ses clés : celui de la clé « primaire » (dernière de la
 * multi-sélection) si le geste en reprend une, sinon la tête de lecture (règle : `gizmoKeyTime`).
 *
 * Quand il s'écarte de la tête de lecture, le geste l'y amène (cf. `onDragging`) : la scène et le
 * PiP montrent le temps de lecture, donc une clé éditée à un autre instant ne se voyait pas bouger.
 */
export function strokeTime(a: Pick<CameraAnimState, 'selection' | 'anim' | 'timeMs'>): number {
  const primary = a.selection[a.selection.length - 1];
  const selTime = primary ? a.anim.channels[primary.channel]?.keys[primary.index]?.t : undefined;
  return gizmoKeyTime(selTime, a.timeMs);
}

/**
 * Caméra-objet dans la scène (Phase 17, mode layout) : monte le mesh caméra + sa trajectoire dans
 * la scène du viewer (splat ou 3D), le **synchronise à l'animation** chaque frame, et — en édition
 * — attache un gizmo `TransformControls` que l'on greffe au corps de la caméra ou au marqueur de
 * cible (raycast au clic). Déplacer la caméra pose/écrase une clé **position**, déplacer la cible
 * pose une clé **cible**, au temps de la clé sélectionnée (sinon au playhead — auto-key).
 *
 * C'est aussi **l'échantillonneur de la pose du plan hors lecture** : monté exactement quand on est
 * hors caméra, il rend chaque frame la pose que l'animation décrit et la remet à `layout.applyShot`,
 * d'où le PiP. Le mesh de la caméra-objet et la fenêtre PiP montrent donc la même chose, toujours.
 */
export function useCameraSceneRig(opts: {
  getSceneHandle: () => ViewerSceneHandle | null;
  subscribeFrame: (cb: (dt: number) => void) => () => void;
  ready: boolean;
  editable: boolean;
  anim: CameraAnimState;
  /**
   * État du « dans / hors caméra » (modèle en tête de `viewer/useLayoutMode`). Une seule
   * dépendance, et non trois rappels épars : le rig n'existe **qu'**hors caméra, il part de la vue
   * d'activation, et il est l'échantillonneur de la pose du plan hors lecture — sans quoi le PiP
   * restait figé jusqu'au prochain scrub, alors que le gizmo, une courbe, une tangente ou une
   * annulation venaient de changer le plan. Pendant la lecture, c'est le lecteur qui pilote.
   */
  layout: Pick<LayoutModeState, 'layoutMode' | 'getActivationView' | 'applyShot'>;
}) {
  const { getSceneHandle, subscribeFrame, ready, editable, anim, layout } = opts;
  // Membres stables (`useCallback`) : l'objet `layout`, lui, est neuf à chaque rendu — le prendre
  // en dépendance d'effet remonterait la caméra-objet et son gizmo à chaque rendu.
  const { layoutMode: active, getActivationView, applyShot } = layout;
  const objRef = useRef<CameraObjectRuntime | null>(null);
  const controlRef = useRef<TransformControls | null>(null);
  const [mode, setMode] = useState<RigGizmoMode>('translate');
  const modeRef = useRef(mode);
  modeRef.current = mode;
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
      // Objet d'aide : le gizmo est posé sur la caméra du plan, donc pile devant l'objectif —
      // laissé dans la passe PiP, il barrait la vue du plan (cf. `viewer/sceneHelpers`).
      const unregisterHelper = registerSceneHelpers(helper);
      controlRef.current = control;

      // Cible courante du gizmo : corps (position/orientation) ou marqueur (cible du regard).
      let editing: 'body' | 'target' | null = null;
      // Distance de regard figée au début d'une rotation (conservée en réorientant la cible).
      let rotateDist = 0;
      const fwd = new THREE.Vector3();
      const onDragging = (e: { value: unknown }) => {
        controls.enabled = !e.value; // gèle l'orbite pendant la manipulation
        if (!e.value) return;
        const a = animRef.current;
        a.beginStroke();
        // La tête de lecture rejoint le temps où le geste va écrire. La scène et le PiP montrent
        // **le temps de lecture** : reprendre au gizmo une clé posée à un autre instant ne se
        // voyait donc pas — la caméra-objet revenait chaque frame sur la pose du playhead, et
        // l'artiste concluait que le gizmo ne bougeait rien.
        const t = strokeTime(a);
        if (t !== Math.round(a.timeMs)) a.scrub(t);
        // Distance de regard lue de la pose **échantillonnée à ce temps**, et non du maillage :
        // celui-ci ne rattrapera le nouveau temps qu'à la frame suivante.
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
          // Rotation du corps → réoriente la cible (+Z du corps), distance de regard conservée.
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

      // Sélection de la cible du gizmo au clic (raycast sur corps / marqueur). Le corps prend le
      // mode courant (translate/rotate) ; le marqueur de cible reste en translation.
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

    // Synchronisation par frame : la caméra-objet suit la pose animée + trajectoire à jour.
    const offFrame = subscribeFrame(() => {
      const a = animRef.current;
      // Sans clé, la caméra-objet se pose sur la vue d'activation du layout (manipulable dès le
      // premier contact en édition) — les canaux non clés y retombent aussi.
      const base = getActivationView() ?? BASE_POSE;
      const pose = sampleAnimV2(a.anim, a.timeMs, base);
      obj.update(pose);
      obj.setVisible(a.hasAnimation || editable);
      // Le PiP montre exactement la pose que porte la caméra-objet — une seule source.
      if (!a.playing) applyShot(pose);
      // Recalcule la trajectoire seulement quand l'animation change (tous canaux, cf. `trajectory`).
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

  // Applique le mode courant au gizmo quand il est attaché au corps (sans réinstaller le gizmo).
  useEffect(() => {
    const c = controlRef.current;
    if (c && c.object === objRef.current?.body) c.setMode(mode);
  }, [mode]);

  return { mode, setMode };
}
