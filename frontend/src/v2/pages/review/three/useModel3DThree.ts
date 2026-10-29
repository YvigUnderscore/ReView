// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { api } from '@/lib/apiClient';
import { qk } from '@/v2/lib/query';
import { DEFAULT_TRANSFORM, type MediaResp, type Transform } from '../reviewTypes';
import { applyEulerTransform } from './applyTransform';
import { updateOrbitKeepingRoll } from './cameraRoll';
import { createModelScene, type ModelScene } from './createModelScene';
import { loadModel } from './loadModel';
import { fitDistance, resizeRendererCamera } from './sceneConfig';
import { useModelPoi } from './useModelPoi';
import { createSampler, type Sampler } from './statsSampler';
import type { ModelPerfSample } from './perfStats';
import { useModelScale } from './useModelScale';
import { useModelCameraHandles } from './useModelCameraHandles';
import { useModelAnimations } from './useModelAnimations';
import { useModelLayout } from './useModelLayout';
import { DEFAULT_REVIEW_ASPECT } from '../frameRect';
import { mediaReviewAspect } from '../reviewAspect';
import { createFlyControls, type FlyControls } from '../viewer/flyControls';
import { useThumbnailCapture } from '../viewer/useThumbnailCapture';
import { viewCapturer } from '../viewer/viewCapture';
import { useRenderGate } from '../viewer/renderScheduler';
import type { ViewerSceneHandle } from '../viewer/sceneHandle';
import { useModelFraming } from './useModelFraming';
import { useSaveTransform } from './useSaveTransform';

export interface SceneRuntime {
  scene: ModelScene;
  mixer: THREE.AnimationMixer | null;
  clips: THREE.AnimationClip[];
  /** Layout camera of the PiP (layout mode) — driven by the keyframe reader when active. */
  layoutCam: THREE.PerspectiveCamera;
  /** Bounding radius of the loaded model — original view (H) and reframing. */
  modelRadius: number;
  /** Center of the normalized model (resting on `y = 0`) — target of the original view and the turntable. */
  modelCenter: THREE.Vector3;
  /** Object of the main loaded model (child of `root`) — target of the A/B comparison (39.E). */
  modelObject: THREE.Object3D;
  /** glTF root (mixer target, distinct from the normalization wrapper — 40.A); host of the
   *  SkeletonHelper (skeleton debug 40.B). */
  animRoot: THREE.Object3D;
  /** Number of `SkinnedMesh` in the model (>0 → skeleton debug available — 40.B). */
  skinnedCount: number;
  /** Loaded glTF — embedded material variants and cameras (40.C). */
  gltf: GLTF;
  /** Raw bounding box of the model (file units) — real dimensions and measurement. */
  modelBox: THREE.Box3;
  /** Normalization factor computed at load time — kept for the real-size toggle. */
  normScale: number;
}

/**
 * **Three.js** 3D model viewer (Phase 15): `createModelScene` base, GLB loading, render loop
 * (damping + mixer), user transform, object-space hotspots, camera (capture/restore, tilt, focal
 * length), **navigation unified with the splat** (Phase 17: orbit + pan, right-click flight +
 * ZQSD, F/H shortcuts) and **layout mode** (PiP "in/out camera" via `useModelLayout`). Animations
 * are extracted into `useModelAnimations`.
 */
export function useModel3DThree(data: MediaResp | null, glbSrc: string | null) {
  const active = data?.media.kind === 'MODEL_3D';
  const versionId = data?.media.versionId;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<SceneRuntime | null>(null);
  const threeRef = useRef<typeof import('three') | null>(null);
  const actionRef = useRef<THREE.AnimationAction | null>(null);
  // Performance counters (FPS, draw calls, triangles) — fed by the render loop and read by the
  // Scene panel. Nothing is measured while nobody is subscribed.
  const statsRef = useRef<Sampler<ModelPerfSample> | null>(null);
  // Points of interest: the SAME hook as the splat (`poi/usePoiMarkers`), through its adapter.
  const { mountMarker, project, hotspotAtPointer, showPoiPoints, setPoiHandlers, setPoiActive, focusPoi } =
    useModelPoi(runtimeRef, threeRef);
  const frameCbs = useRef(new Set<(dt: number) => void>());
  // On-demand rendering (F14) — carries invalidation, passive subscriptions and the loop.
  const gate = useRenderGate();
  // Thumbnail (Phase 20): the capture follows a render — the hook requests one on each request.
  const { onFrame: captureFrame, capture: captureThumbnail } = useThumbnailCapture(gate);
  const flyRef = useRef<FlyControls | null>(null);
  // Aspect of the delivery frame (inherited pipeline settings, or aspect frozen by a presentation
  // — see `reviewAspect`): the camera keeps it whatever the screen, the view being extended to the
  // whole container (Phase 25, see resizeRendererCamera).
  const frameAspectRef = useRef<number>(DEFAULT_REVIEW_ASPECT);
  frameAspectRef.current = mediaReviewAspect(data).value;
  // View capture for the Export panel: a render dedicated to the delivery frame, without the floor grid.
  const captureView = viewCapturer(
    () => runtimeRef.current?.scene,
    () => frameAspectRef.current,
    gate.invalidate,
  );
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // glTF extensions declared by the loaded file (tech sheet — 39.C).
  const [extensions, setExtensions] = useState<string[]>([]);
  // Raw bounding box dimensions, in the file's units (measurement, 39.G).
  const [modelSize, setModelSize] = useState<[number, number, number] | null>(null);

  // Transform recorded on the version, overridden by the unsaved local edit.
  const versionQ = useQuery({
    queryKey: qk.version(versionId ?? 0),
    queryFn: () =>
      api
        .get<{ version: { transform: Partial<Transform> | null } }>(`/api/versions/${versionId}`)
        .then((d) => d.version),
    enabled: active && !!versionId,
  });
  const [tfEdit, setTfEdit] = useState<Transform | null>(null);
  const savedTransform = versionQ.data?.transform;
  const transform = useMemo(
    () => tfEdit ?? (savedTransform ? { ...DEFAULT_TRANSFORM, ...savedTransform } : DEFAULT_TRANSFORM),
    [tfEdit, savedTransform],
  );

  // ── Camera controller (shared with the splat): loop, canvas, capture/restore ──
  const subscribeFrame = useCallback((cb: (dt: number) => void) => {
    frameCbs.current.add(cb);
    return () => frameCbs.current.delete(cb);
  }, []);
  const getDom = useCallback(() => runtimeRef.current?.scene.renderer.domElement ?? containerRef.current, []);
  // View capture/restore (view state included), focal length and tilt.
  const { captureCamera, restoreCamera, registerViewState, fov, setFov, roll, setRoll } =
    useModelCameraHandles({ runtimeRef, threeRef });
  const subscribeStats = useCallback(
    (cb: (stats: { fps: number } & ModelPerfSample) => void) =>
      gate.countSub(statsRef.current?.subscribe(cb)) ?? (() => {}),
    [gate],
  );
  const isFlying = useCallback(() => flyRef.current?.flying ?? false, []);

  /** Common imperative handle (gizmos, object camera, framing) — see `viewer/sceneHandle`. */
  const getSceneHandle = useCallback((): ViewerSceneHandle | null => {
    const rt = runtimeRef.current;
    const THREE = threeRef.current;
    if (!rt || !THREE) return null;
    return {
      THREE,
      scene: rt.scene.scene,
      camera: rt.scene.camera,
      controls: rt.scene.controls,
      dom: rt.scene.renderer.domElement,
      renderer: rt.scene.renderer,
      mesh: rt.scene.root,
      modelObject: rt.modelObject,
      gltf: rt.gltf,
    };
  }, []);

  // `setFrameTarget` (46.I): review plugs the selected prim in there so that `F` frames it.
  const { frameView, homeView, setFrameTarget } = useModelFraming({ runtimeRef, threeRef, ready, isFlying });
  // Real-size toggle (39.G): the model takes back the units of its file. The preference is
  // replayed on every loaded model via `reapplyScaleRef`.
  const reapplyScaleRef = useRef<(() => void) | null>(null);
  const { realScale, setRealScale } = useModelScale({
    runtimeRef,
    threeRef,
    homeView,
    reapplyRef: reapplyScaleRef,
  });

  const anim = useModelAnimations(runtimeRef, actionRef, threeRef, gate.subscribeIdle);
  // `init` stays private (called at load time); the rest of the transport is exposed as is.
  const { init: animInit, ...animApi } = anim;
  const layout = useModelLayout({ runtimeRef, threeRef, subscribeFrame, getDom, captureCamera });
  const { renderPip } = layout;

  useEffect(() => {
    const container = containerRef.current;
    if (!active || !glbSrc || !container) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    void (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      if (cancelled || !containerRef.current) return;
      threeRef.current = THREE;
      const scene = createModelScene({ THREE, OrbitControls }, container);
      // Points-of-interest markers (DOM, projected on screen) — their lifecycle and state belong
      // to the shared hook; the viewer only mounts and projects them.
      const unmountMarker = mountMarker(THREE, container);
      // Render counters: `renderer.info` is reset by Three on every frame, so we read it at the
      // end of the loop, not at subscription time.
      statsRef.current = createSampler<ModelPerfSample>(() => ({
        calls: scene.renderer.info.render.calls,
        triangles: scene.renderer.info.render.triangles,
        geometries: scene.renderer.info.memory.geometries,
        textures: scene.renderer.info.memory.textures,
      }));
      let model;
      try {
        model = await loadModel(THREE, new GLTFLoader(), glbSrc);
      } catch {
        if (!cancelled) setLoadError(true);
        scene.dispose();
        unmountMarker();
        return;
      }
      if (cancelled) {
        scene.dispose();
        unmountMarker();
        return;
      }
      scene.root.add(model.object);
      // The mixer targets the glTF root (not the normalization wrapper): a track on the root node
      // no longer breaks the framing (40.A).
      const mixer = model.animations.length ? new THREE.AnimationMixer(model.animRoot) : null;
      // Starting focal length = that of the current view, as on the splat side: a PiP that opens
      // with a different focal length than the scene has nothing to do with the plane being set.
      const layoutCam = new THREE.PerspectiveCamera(scene.camera.fov, 16 / 9, 0.01, 1000);
      runtimeRef.current = {
        scene,
        mixer,
        clips: model.animations,
        layoutCam,
        modelRadius: model.radius,
        modelCenter: model.center,
        modelObject: model.object,
        animRoot: model.animRoot,
        skinnedCount: model.skinnedCount,
        gltf: model.gltf,
        modelBox: model.box,
        normScale: model.scale,
      };
      setExtensions(model.extensions);
      // **Raw** file dimensions: the only measurement that normalization would destroy if it were
      // not recorded here (the wrapper, for its part, will be rescaled on demand).
      const raw = model.box.getSize(new THREE.Vector3());
      setModelSize([raw.x, raw.y, raw.z]);
      animInit(model.animations);
      // Navigation unified with the splat (Phase 17): right-click flight + ZQSD/WASD + A/E,
      // middle-button pan (set by createFlyControls), orbit on left click.
      const fly = createFlyControls(THREE, scene.camera, scene.controls, scene.renderer.domElement);
      flyRef.current = fly;

      const resize = () => {
        gate.invalidate(); // `setSize` clears the drawing buffer: it must be redrawn right away
        const { clientWidth: w, clientHeight: h } = container;
        resizeRendererCamera(scene.renderer, scene.camera, w, h, frameAspectRef.current);
      };
      resize();
      // Initial framing (once the aspect is known) + near/far shared with the layout camera. The
      // model rests on `y = 0`: the camera aims at its center, not the origin (otherwise it would look
      // at the ground and the model would leave the frame at the top).
      const dist = fitDistance(model.radius, scene.camera.fov, scene.camera.aspect || 1);
      if (dist > 0) {
        scene.camera.position.set(model.center.x, model.center.y, model.center.z + dist);
        scene.controls.target.copy(model.center);
        scene.camera.near = layoutCam.near = Math.max(model.radius / 100, 0.001);
        scene.camera.far = layoutCam.far = model.radius * 100;
        scene.camera.updateProjectionMatrix();
        layoutCam.updateProjectionMatrix();
        scene.controls.update();
      }
      // Current real-size preference: replayed on this model, framing included — the wrapper has just
      // been set normalized, the toggle would otherwise lie.
      reapplyScaleRef.current?.();
      const ro = new ResizeObserver(resize);
      ro.observe(container);

      // `update` runs on every tick; only `draw` (GPU passes + layout measurements) is skipped when
      // the image would be identical — see `renderScheduler` for the safeguards.
      const stopLoop = gate.start({
        renderer: scene.renderer,
        controls: scene.controls,
        isBusy: () => fly.flying || frameCbs.current.size > 0 || actionRef.current?.isRunning() === true,
        update: (dt) => {
          // In flight, the camera is driven by flyControls; OrbitControls (frozen) must not reframe
          // it on its target — otherwise keyboard movement would be cancelled. Outside flight, the
          // orbit keeps the tilt that was set (see `cameraRoll.updateOrbitKeepingRoll`).
          if (fly.flying) fly.update(dt);
          else updateOrbitKeepingRoll(THREE, scene.camera, scene.controls);
          mixer?.update(dt);
          frameCbs.current.forEach((cb) => cb(dt));
        },
        draw: (now) => {
          scene.renderer.render(scene.scene, scene.camera);
          renderPip(); // PiP of the layout camera (no-op outside layout mode)
          const { clientWidth: w, clientHeight: h } = container;
          project(scene.camera, scene.root, w, h);
          statsRef.current?.frame(now);
          captureFrame(scene.renderer.domElement); // auto thumbnail (Phase 20)
        },
      });
      setReady(true);
      cleanup = () => {
        ro.disconnect();
        stopLoop();
        fly.dispose();
        flyRef.current = null;
        unmountMarker();
        scene.dispose();
      };
    })().catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
      cleanup?.();
      // `ready` must stay **faithful** to the presence of the runtime: hooks subscribing to the
      // imperative scene (USD scenegraph, click selection, object camera) cannot guess that the refs
      // have just been emptied. Without this switch back to `false`, a change of `glbSrc` would leave
      // them wired to a vanished scene, and their effect would never be replayed on the new one.
      setReady(false);
      runtimeRef.current = null;
      threeRef.current = null;
      actionRef.current = null;
      statsRef.current = null;
    };
  }, [active, glbSrc, animInit, renderPip, captureFrame, mountMarker, project, gate]);

  // Applies the transform (orientation + scale) to the parent group, live.
  useEffect(() => {
    const rt = runtimeRef.current;
    if (!rt || !ready) return;
    applyEulerTransform(rt.scene.root, transform);
    gate.invalidate();
  }, [transform, ready, gate]);

  const updateTransform = useCallback(
    (patch: Partial<Transform>) => {
      const next = { ...transform, ...patch };
      const rt = runtimeRef.current;
      if (rt) applyEulerTransform(rt.scene.root, next);
      gate.invalidate();
      setTfEdit(next);
    },
    [transform, gate],
  );

  const saveTransform = useSaveTransform(versionId, transform, () => setTfEdit(null));

  const clearLoadError = useCallback(() => setLoadError(false), []);

  return {
    containerRef,
    ready,
    extensions,
    transform,
    updateTransform,
    saveTransform,
    /** Transform modified locally and not yet saved on the version. */
    tfDirty: tfEdit !== null,
    loadError,
    clearLoadError,
    // Animation transport of the GLB (40.A): animations, currentAnim, playing, timeMs, durationMs,
    // speed, loop, play, pause, selectAnim, scrub, setSpeed, setLoop.
    ...animApi,
    hotspotAtPointer,
    showPoiPoints,
    setPoiHandlers,
    setPoiActive,
    focusPoi,
    captureThumbnail,
    /** Full-frame PNG of the current view (Export panel) — `null` if the capture failed. */
    captureView,
    captureCamera,
    restoreCamera,
    registerViewState,
    subscribeStats,
    subscribeFrame,
    /** Raw dimensions of the model (file units) — `null` until it is loaded. */
    modelSize,
    /** Current normalization factor: 1 at real size, otherwise `TARGET_SIZE / maxDim`. */
    realScale,
    setRealScale,
    getDom,
    getSceneHandle,
    isFlying,
    frameView,
    homeView,
    setFrameTarget,
    fov,
    setFov,
    roll,
    setRoll,
    layoutMode: layout.layoutMode,
    setLayoutMode: layout.setLayoutMode,
    layoutController: layout.layoutController,
    setPipRect: layout.setPipRect,
    /** Full state of the "in / out of camera" — consumed as is by the object camera. */
    layout,
  };
}

export type Model3DThreeState = ReturnType<typeof useModel3DThree>;
