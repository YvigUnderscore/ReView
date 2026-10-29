// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createModelScene } from '../review/three/createModelScene';
import { loadModel } from '../review/three/loadModel';
import { fitDistance, resizeRendererCamera } from '../review/three/sceneConfig';
import { restoreModelCamera } from '../review/three/modelCamera';
import { applyLighting, loadHdriEnvironment, type HdriEnvironment } from '../review/three/hdriEnvironment';
import { setGroundShadow } from '../review/three/groundShadow';
import { createFlyControls } from '../review/viewer/flyControls';
import { DEFAULT_REVIEW_ASPECT } from '../review/frameRect';
import type { ViewerSceneHandle } from '../review/viewer/sceneHandle';
import { clientFrameAspect, clientLighting } from './clientViewerModel';
import type { ClientMediaSource } from './clientTypes';

/**
 * **Read-only** 3D viewer of the client share.
 *
 * It reuses the internal viewer's base as is (`createModelScene`, `loadModel`,
 * `resizeRendererCamera`, `createFlyControls`, `applyLighting`) and stops there: no gizmo,
 * no version transform, no recomposition, no writes. What is replayed is what the studio
 * **persisted**: delivery frame, camera pose, HDRI lighting, embedded animation. No
 * authenticated call is made: the guest has no account, and the only source of truth is the
 * share payload.
 */
export interface ClientModel3DViewer {
  containerRef: React.RefObject<HTMLDivElement | null>;
  ready: boolean;
  loadError: boolean;
  /** Reframes the original view (`H` shortcut): the only command offered to the guest. */
  homeView: () => void;
  /** Imperative handle to the scene, consumed by the replay of the override (46.D). */
  getSceneHandle: () => ViewerSceneHandle | null;
}

interface Runtime {
  scene: ReturnType<typeof createModelScene>;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  modelObject: THREE.Object3D;
  center: THREE.Vector3;
  radius: number;
}

export function useClientModel3D(
  glbSrc: string | null,
  source: ClientMediaSource | undefined,
): ClientModel3DViewer {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const threeRef = useRef<typeof import('three') | null>(null);
  const envRef = useRef<HdriEnvironment | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Aspect and camera pose are read through a ref: they belong to the scene's mount, not to
  // React's render cycle. Reading them as dependencies would remount the whole viewer.
  const aspectRef = useRef(DEFAULT_REVIEW_ASPECT);
  aspectRef.current = clientFrameAspect(source);
  const poseRef = useRef<unknown>(null);
  poseRef.current = source?.splatPresentation?.camera ?? null;

  const getSceneHandle = useCallback((): ViewerSceneHandle | null => {
    const rt = runtimeRef.current;
    const THREE = threeRef.current;
    if (!rt || !THREE) return null;
    return {
      THREE,
      scene: rt.scene.scene,
      camera: rt.camera,
      controls: rt.controls,
      dom: rt.scene.renderer.domElement,
      renderer: rt.scene.renderer,
      mesh: rt.scene.root,
      modelObject: rt.modelObject,
    };
  }, []);

  const homeView = useCallback(() => {
    const rt = runtimeRef.current;
    if (!rt) return;
    const dist = fitDistance(rt.radius, rt.camera.fov, rt.camera.aspect || 1);
    if (dist <= 0) return;
    rt.camera.position.set(rt.center.x, rt.center.y, rt.center.z + dist);
    rt.controls.target.copy(rt.center);
    rt.camera.up.set(0, 1, 0);
    rt.controls.update();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!glbSrc || !container) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      if (cancelled || !containerRef.current) return;
      threeRef.current = THREE;
      const scene = createModelScene({ THREE, OrbitControls }, container);
      let model;
      try {
        model = await loadModel(THREE, new GLTFLoader(), glbSrc);
      } catch {
        scene.dispose();
        if (!cancelled) setLoadError(true);
        return;
      }
      if (cancelled) {
        scene.dispose();
        return;
      }
      scene.root.add(model.object);
      // Embedded animation (40.A): a turntable lookdev must play at the client's as it does at
      // the artist's. Loops the first clip, with no transport to drive.
      const mixer = model.animations.length ? new THREE.AnimationMixer(model.animRoot) : null;
      mixer?.clipAction(model.animations[0]).play();

      // Navigation: orbit, pan and right-click fly, exactly as in the internal review.
      const fly = createFlyControls(THREE, scene.camera, scene.controls, scene.renderer.domElement);

      const resize = () =>
        resizeRendererCamera(
          scene.renderer,
          scene.camera,
          container.clientWidth,
          container.clientHeight,
          aspectRef.current,
        );
      resize();
      const dist = fitDistance(model.radius, scene.camera.fov, scene.camera.aspect || 1);
      if (dist > 0) {
        scene.camera.position.set(model.center.x, model.center.y, model.center.z + dist);
        scene.controls.target.copy(model.center);
        scene.camera.near = Math.max(model.radius / 100, 0.001);
        scene.camera.far = model.radius * 100;
        scene.camera.updateProjectionMatrix();
        scene.controls.update();
      }
      // Pose persisted by the studio takes precedence over automatic framing: it is what the
      // client must see when opening the media ("replayed identically").
      restoreModelCamera(THREE, scene.camera, scene.controls, poseRef.current);

      const ro = new ResizeObserver(resize);
      ro.observe(container);
      let last = performance.now();
      scene.renderer.setAnimationLoop(() => {
        const now = performance.now();
        const dt = (now - last) / 1000;
        last = now;
        if (fly.flying) fly.update(dt);
        else scene.controls.update();
        mixer?.update(dt);
        scene.renderer.render(scene.scene, scene.camera);
      });

      runtimeRef.current = {
        scene,
        camera: scene.camera,
        controls: scene.controls,
        modelObject: model.object,
        center: model.center,
        radius: model.radius,
      };
      setReady(true);
      cleanup = () => {
        ro.disconnect();
        scene.renderer.setAnimationLoop(null);
        fly.dispose();
        mixer?.stopAllAction();
        scene.dispose();
      };
    })().catch(() => !cancelled && setLoadError(true));

    return () => {
      cancelled = true;
      cleanup?.();
      setReady(false);
      runtimeRef.current = null;
      threeRef.current = null;
    };
  }, [glbSrc]);

  // Replayed lighting (HDRI, exposure, rotation, background, shadow ground). The guest has no
  // access to `/api/studio/hdris`: the presigned URL must come from the share payload, otherwise
  // only exposure and neutral lights apply.
  const hdriUrl = source?.hdri?.url ?? null;
  const hdriFormat = source?.hdri?.format ?? 'hdr';
  // Primitive fields rather than the object: the TanStack query returns a new object on each
  // refetch, and the effect would reload the HDRI every time.
  const { exposure, rotationDeg, showBackground, groundShadow } = clientLighting(source);
  useEffect(() => {
    if (!ready) return;
    const handle = getSceneHandle();
    if (!handle?.renderer) return;
    const { THREE, scene, renderer } = handle;
    const cfg = { exposure, rotationDeg, showBackground, groundShadow };
    setGroundShadow(handle, groundShadow);
    if (!hdriUrl) {
      envRef.current?.dispose();
      envRef.current = null;
      applyLighting(scene, renderer, null, cfg);
      return;
    }
    let cancelled = false;
    void loadHdriEnvironment(THREE, renderer, hdriUrl, hdriFormat)
      .then((env) => {
        if (cancelled) {
          env.dispose();
          return;
        }
        envRef.current?.dispose();
        envRef.current = env;
        applyLighting(scene, renderer, env.texture, cfg);
      })
      .catch(() => applyLighting(scene, renderer, null, cfg));
    return () => {
      cancelled = true;
    };
  }, [ready, getSceneHandle, hdriUrl, hdriFormat, exposure, rotationDeg, showBackground, groundShadow]);

  useEffect(
    () => () => {
      envRef.current?.dispose();
      envRef.current = null;
    },
    [],
  );

  return { containerRef, ready, loadError, homeView, getSceneHandle };
}
