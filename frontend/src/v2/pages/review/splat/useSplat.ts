// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import { createScene, type SplatModules } from './scene/createScene';
import { DEFAULT_REVIEW_ASPECT } from '../frameRect';
import { resizeRendererCamera } from '../three/sceneConfig';
import { updateOrbitKeepingRoll } from '../three/cameraRoll';
import { createFlyControls } from '../viewer/flyControls';
import { frameCameraToMesh } from './scene/frameCamera';
import { meshBounds } from './editor/selection/bounds';
import { raycastAt } from './scene/raycast';
import { usePoiMarkers, type PoiSceneAccess } from '../poi/usePoiMarkers';
import type { PointCloud } from './scene/pointCloud';
import { createStatsSampler, type StatsSampler } from './scene/stats';
import { readCullingOff } from './scene/cullingDefault';
import type { SplatScene, SplatViewer } from './scene/splatViewerTypes';
import { useCameraHandles } from './scene/useCameraHandles';
import { useSplatHandles } from './scene/useSplatHandles';
import { toThumbnail } from '../viewer/thumbnail';
import { viewCapturer } from '../viewer/viewCapture';
import { applyCulling } from './scene/viewerConfig';
import { renderPipPass, type PipRect } from '../viewer/pipWindow';
import { useRenderGate, SETTLE_WINDOW_MS } from '../viewer/renderScheduler';

// Viewer contracts (scene, editing handle, API rendered to the page): defined in
// `scene/splatViewerTypes`, re-exported here: the viewer's public entry point stays `useSplat`.
export type { SplatSceneHandle, SplatViewer } from './scene/splatViewerTypes';

/**
 * Viewer Gaussian Splat (Spark/SparkJS) — 10.G.
 * Thin orchestrator: delegates the scene mounting to `scene/createScene`, the auto-framing to
 * `scene/frameCamera`, the raycast to `scene/raycast` and the thumbnail to `scene/thumbnail`. Handles
 * here the React lifecycle, the render loop, the points hotspots and the camera view
 * (stored in `Comment.cameraState`, like the 3D review). No dependency on model-viewer.
 *
 * three, OrbitControls and Spark are imported dynamically (only when a splat is opened)
 * to stay out of the initial bundle: the type-only imports above are erased.
 *
 * The imperative handles (thumbnail, render modes, stats, culling, PiP) live in
 * `scene/useSplatHandles`; the points of interest in `poi/usePoiMarkers`, the same hook as the
 * 3D viewer. Both only read the refs mounted here.
 */
export function useSplat(url: string | null, fileName: string, frameAspect?: number): SplatViewer {
  const containerRef = useRef<HTMLDivElement>(null);
  // Delivery frame aspect (Phase 25): the camera keeps it whatever the screen,
  // the view being extended to the whole container (setViewOffset, cf. resizeRendererCamera).
  const frameAspectRef = useRef<number>(DEFAULT_REVIEW_ASPECT);
  frameAspectRef.current = frameAspect ?? DEFAULT_REVIEW_ASPECT;
  const sceneRef = useRef<SplatScene | null>(null);
  const threeRef = useRef<typeof import('three') | null>(null);
  // Resolver of a pending thumbnail capture (filled after the next render).
  const captureReq = useRef<((d: string | null) => void) | null>(null);
  // Points of interest: the SAME hook as the 3D viewer (`poi/usePoiMarkers`). They differ here only
  // by the carrying object (the SplatMesh), the scene ray and the surface ray: a splat has no
  // triangles, so it is `raycastAt` that queries the cloud.
  const poiAccess = useCallback((): PoiSceneAccess | null => {
    const scene = sceneRef.current;
    const THREE = threeRef.current;
    if (!scene || !THREE) return null;
    return {
      three: THREE,
      camera: scene.camera,
      controls: scene.controls,
      object: scene.mesh,
      dom: scene.renderer.domElement,
      radius: meshBounds({ THREE, mesh: scene.mesh })?.radius ?? 1,
      pick: (ndc) => raycastAt(THREE, scene.camera, scene.mesh, ndc),
    };
  }, []);
  const poi = usePoiMarkers(poiAccess);
  const { mountMarker, project: projectPoi } = poi;
  // Point-cloud overlay of the points mode (child of the mesh, built on demand),
  // reactive to the selection and to deletions (setSelection/setHidden).
  const pointsRef = useRef<PointCloud | null>(null);
  // Stats sampler (FPS, splats), fed by the render loop.
  const statsRef = useRef<StatsSampler | null>(null);
  // Callbacks called on each frame (dt in seconds): camera animation, presets (V5).
  const frameCbs = useRef(new Set<(dt: number) => void>());
  // Flight controls (right click + ZQSD): exposed to inhibit the editing shortcuts (11.G).
  const flyRef = useRef<ReturnType<typeof createFlyControls> | null>(null);
  // PiP window rect (layout mode, Phase 27): non-null means a second render pass per frame.
  const pipRectRef = useRef<PipRect | null>(null);
  // On-demand rendering (F14): carries the invalidation, the FPS-reader count and the loop.
  const gate = useRenderGate();
  // View capture for the Export panel: rendering dedicated to the delivery frame, without the floor grid.
  const captureView = viewCapturer(
    () => sceneRef.current,
    () => frameAspectRef.current,
    gate.invalidate,
  );
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Progress of the splat file download (41.B): starts at 0, becomes null once the file is
  // received (decoding/LOD takes over, with no measurable progress).
  const [progress, setProgress] = useState<number | null>(0);

  useEffect(() => {
    // No state reset here (react-hooks/set-state-in-effect rule): the review page is remounted
    // via `key={mediaId}` for each media, so ready/loadError start again from false.
    const container = containerRef.current;
    if (!url || !container) return;

    let cancelled = false;
    let cleanup: (() => void) | null = null;
    const frameCallbacks = frameCbs.current;

    void (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      const { SparkRenderer, SplatMesh } = await import('@sparkjsdev/spark');
      if (cancelled || !containerRef.current) return;
      threeRef.current = THREE;

      const modules: SplatModules = { THREE, OrbitControls, SparkRenderer, SplatMesh };
      const { renderer, scene, camera, controls, spark } = createScene(modules, container);
      // Culling active by default (lot 8), unless the user prefers otherwise. Same reading as
      // the panel toggle (`useSplatView`): the two can no longer diverge, neither from each other
      // nor from what is remembered.
      applyCulling(spark, readCullingOff());
      // Unreal-style fly navigation (right click + ZQSD/WASD + A/E): freezes the orbit in flight.
      const fly = createFlyControls(THREE, camera, controls, renderer.domElement);
      flyRef.current = fly;

      // Numbered points-of-interest pins (DOM, projected on screen): inert when reading,
      // manipulable while composing (cf. `objectHotspot.setInteractive`).
      const unmountMarker = mountMarker(THREE, container);

      // Auto-framing: after loading, sets camera and target on the splat's bbox (once only).
      let framed = false;
      const onReady = () => {
        if (cancelled) return;
        setProgress(null); // file received: decoding/LOD takes over (41.B)
        if (!framed) framed = frameCameraToMesh(THREE, mesh, camera, controls);
        // The cloud keeps refining after `onLoad` (decoding, LOD, first sort): we allow two seconds
        // at full speed before falling back to on-demand rendering.
        gate.invalidate(SETTLE_WINDOW_MS);
        setReady(true);
      };

      // `lod: true`: the LOD data is built at load time (WASM worker); without it,
      // `SparkRenderer.enableLod` is inert (driveLod filters on packedSplats.lodSplats).
      // `nonLod: true`: ALSO keeps the base splats (without it, direct rendering, LOD disengaged,
      // our default, is empty). The LOD only applies if V7 engages it.
      // SOG (41.C reading): Spark maps the `.sog` extension to PCSOGSZIP but not `.sogs`, so we
      // normalise it for type detection (the PCSOGS zip container is still served as is).
      const mesh = new SplatMesh({
        url,
        fileName: fileName.replace(/\.sogs$/i, '.sog'),
        raycastable: true,
        lod: true,
        nonLod: true,
        onLoad: onReady,
        // Network progress (41.B): the presigned MinIO GET returns Content-Length, so the ratio is real.
        onProgress: (e: ProgressEvent) => {
          if (cancelled) return;
          setProgress(e.lengthComputable && e.total > 0 ? Math.min(1, e.loaded / e.total) : null);
        },
      });
      // Import orientation (11.E): the gaussian .ply/.spz files are usually Y-down:
      // a parent group carries the flip (rotation of π about X), the user transform staying
      // on the mesh (gizmo, hotspots and painter follow matrixWorld, the flip is transparent).
      const pivot = new THREE.Group();
      pivot.rotation.x = Math.PI;
      scene.add(pivot);
      pivot.add(mesh);
      // Layout camera of the PiP (layout mode): independent of the free camera, without viewOffset.
      const layoutCam = new THREE.PerspectiveCamera(camera.fov, 16 / 9, camera.near, camera.far);
      statsRef.current = createStatsSampler(() => ({
        activeSplats: spark.activeSplats,
        totalSplats: mesh.packedSplats?.numSplats ?? 0,
        calls: renderer.info.render.calls,
      }));
      const init = (mesh as unknown as { initialized?: Promise<unknown> }).initialized;
      init?.then(onReady).catch(() => !cancelled && setLoadError(true));

      const resize = () => {
        gate.invalidate(); // `setSize` empties the drawing buffer: redraw immediately
        const { clientWidth: w, clientHeight: h } = container;
        resizeRendererCamera(renderer, camera, w, h, frameAspectRef.current);
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(container);

      // `update` runs every tick; only `draw` (GPU passes and layout measurements) is skipped
      // when the image would be identical: see `renderScheduler` for the guards.
      const stopLoop = gate.start({
        renderer,
        controls,
        isBusy: () => fly.flying || frameCbs.current.size > 0 || !!captureReq.current,
        update: (dt) => {
          // In flight, the camera is driven by flyControls; OrbitControls (frozen) must not
          // re-frame it on its target, otherwise the keyboard movement would be cancelled. Out of flight,
          // the orbit keeps the tilt that was set (cf. `cameraRoll.updateOrbitKeepingRoll`).
          if (fly.flying) fly.update(dt);
          else updateOrbitKeepingRoll(THREE, camera, controls);
          frameCbs.current.forEach((cb) => cb(dt));
        },
        draw: (now) => {
          renderer.render(scene, camera);
          const { clientWidth: w, clientHeight: h } = container;
          // Layout-mode PiP (Phase 27): view of the layout camera in the floating window.
          // The depth follows the free camera: framing (`F`, real size) resets near/far
          // on the scene scale, and the PiP camera stayed on the loading ones.
          const pip = pipRectRef.current;
          if (pip) renderPipPass(renderer, scene, layoutCam, pip, w, h, camera);
          statsRef.current?.frame(now);
          // Projects the world points to pixels and positions the pins (or hides them).
          projectPoi(camera, mesh, w, h);
          // Thumbnail capture requested: the drawing buffer is intact right after the render.
          const shot = captureReq.current;
          captureReq.current = null;
          shot?.(toThumbnail(renderer.domElement));
        },
      });

      sceneRef.current = { renderer, scene, camera, controls, spark, mesh, pivot, layoutCam };
      cleanup = () => {
        ro.disconnect();
        stopLoop();
        fly.dispose();
        flyRef.current = null;
        controls.dispose();
        pointsRef.current?.dispose();
        pointsRef.current = null;
        (mesh as unknown as { dispose?: () => void }).dispose?.();
        renderer.dispose();
        renderer.domElement.remove();
        unmountMarker();
      };
    })().catch(() => !cancelled && setLoadError(true));

    return () => {
      cancelled = true;
      cleanup?.();
      sceneRef.current = null;
      threeRef.current = null;
      pipRectRef.current = null;
      statsRef.current = null;
      frameCallbacks.clear();
      captureReq.current?.(null);
      captureReq.current = null;
    };
  }, [url, fileName, gate, mountMarker, projectPoi]);

  // Camera-pose handles (free-view capture/restore + layout PiP): dedicated hook (budget).
  const { captureCamera, restoreCamera, restorePipCamera } = useCameraHandles(sceneRef, threeRef);

  // Imperative handles (thumbnail, transform, modes, stats, culling, PiP): dedicated hook
  // (budget): they only read the refs mounted above.
  const handles = useSplatHandles({
    sceneRef,
    threeRef,
    captureReq,
    pointsRef,
    statsRef,
    frameCbs,
    flyRef,
    pipRectRef,
    gate,
  });

  return {
    containerRef,
    ready,
    loadError,
    progress,
    captureCamera,
    restoreCamera,
    restorePipCamera,
    captureView,
    ...poi,
    ...handles,
  };
}
