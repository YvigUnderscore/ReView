// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import type * as THREE from 'three';
import type { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { SplatTransform } from '../../reviewTypes';
import type { SceneViewer } from '../sceneHandle';
import { inhibitOrbit } from '../controlsLock';
import { DEFAULT_GIZMO_SETTINGS, type GizmoSettings } from './gizmoSettings';
import { readMeshTransform } from './meshTransform';

/** Transform gizmo mode, modelled on 3D DCC tools (move / rotate / scale). */
export type GizmoMode = 'translate' | 'rotate' | 'scale';

/** Transform mode of the 3D viewer: navigation (no gizmo) or TRS gizmo. */
export type TransformMode = 'navigate' | GizmoMode;

/** Applies space/snaps/size to the TransformControls (per-target settings, 11.G). */
function applyGizmoSettings(control: TransformControls, s: GizmoSettings): void {
  control.setSpace(s.space);
  control.setTranslationSnap(s.translationSnap);
  control.setRotationSnap(s.rotationSnapDeg != null ? (s.rotationSnapDeg * Math.PI) / 180 : null);
  control.setScaleSnap(s.scaleSnap);
  control.size = s.size;
}

/**
 * 3D transform gizmo (10.G, generalised in Phase 17): attaches a `TransformControls`
 * (three addons) to the viewer's main object (`handle.mesh`: SplatMesh or the 3D model root),
 * or to `target` (e.g. the SDF of a crop volume) when provided, through the shared scene handle
 * (`SceneViewer`). The gizmo is **visible in the scene** (no more sliders in a menu); the orbit
 * is frozen during a drag, and every change reports the TRS of the manipulated object via
 * `onChange`. Dynamic import to stay out of the initial bundle. All the Three logic lives here,
 * not in the components.
 */
export function useTransformGizmo(
  viewer: SceneViewer,
  opts: {
    enabled: boolean;
    mode: GizmoMode;
    /** Gizmo target (default: `handle.mesh` — SplatMesh or model root). */
    target?: THREE.Object3D | null;
    /** Per-target space/snap/size settings (11.G) — "splat" defaults if absent. */
    settings?: GizmoSettings;
    onChange: (t: SplatTransform) => void;
    /** End of manipulation (Phase 26): TRS before/after the drag → undoable operation. */
    onCommit?: (before: SplatTransform, after: SplatTransform) => void;
  },
): void {
  const { enabled, mode, target } = opts;
  const settings = opts.settings ?? DEFAULT_GIZMO_SETTINGS.splat;
  const { ready, getSceneHandle } = viewer;
  const onChangeRef = useRef(opts.onChange);
  onChangeRef.current = opts.onChange;
  const onCommitRef = useRef(opts.onCommit);
  onCommitRef.current = opts.onCommit;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const controlRef = useRef<TransformControls | null>(null);

  useEffect(() => {
    if (!enabled || !ready) return;
    const handle = getSceneHandle();
    if (!handle) return;
    const { scene, camera, controls, mesh, dom } = handle;
    const attached = target ?? mesh;
    if (!attached) return;

    let disposed = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const { TransformControls } = await import('three/addons/controls/TransformControls.js');
      if (disposed) return;
      const control = new TransformControls(camera, dom);
      applyGizmoSettings(control, settingsRef.current); // current settings (dedicated effect below)
      control.setMode(modeRef.current); // current mode without an effect dependency (see effect below)
      control.attach(attached);
      const helper = control.getHelper();
      scene.add(helper);

      let dragStart: SplatTransform | null = null;
      // Orbit inhibitor for the drag (see `controlsLock`). The gizmo used to write
      // `controls.enabled` directly, and its unmount set it back to `true`: arming then disarming
      // a gizmo during a fly restored the orbit MID-FLIGHT, behind the back of `flyControls`. It
      // now only releases its own token.
      let releaseOrbit: (() => void) | null = null;
      const onDragging = (event: { value: unknown }) => {
        if (event.value) {
          releaseOrbit ??= inhibitOrbit(controls, 'gizmo-drag');
          dragStart = readMeshTransform(attached); // drag start: snapshot for the history
          return;
        }
        releaseOrbit?.();
        releaseOrbit = null;
        if (!dragStart) return;
        onCommitRef.current?.(dragStart, readMeshTransform(attached));
        dragStart = null;
      };
      const onObjectChange = () => onChangeRef.current(readMeshTransform(attached));
      control.addEventListener('dragging-changed', onDragging);
      control.addEventListener('objectChange', onObjectChange);
      controlRef.current = control;

      cleanup = () => {
        control.removeEventListener('dragging-changed', onDragging);
        control.removeEventListener('objectChange', onObjectChange);
        control.detach();
        scene.remove(helper);
        control.dispose();
        releaseOrbit?.(); // unmount mid-drag: release the token, not the orbit
        releaseOrbit = null;
        controlRef.current = null;
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [enabled, ready, getSceneHandle, target]);

  // Mode change without reinstalling the gizmo.
  useEffect(() => {
    controlRef.current?.setMode(mode);
  }, [mode]);

  // Settings change (space/snap/size) applied live, without reinstalling the gizmo (11.G).
  useEffect(() => {
    if (controlRef.current) applyGizmoSettings(controlRef.current, settings);
  }, [settings]);
}
