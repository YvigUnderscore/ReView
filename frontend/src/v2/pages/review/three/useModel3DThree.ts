import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type * as THREE from 'three';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import { DEFAULT_TRANSFORM, type Hotspot3D, type MediaResp, type Transform } from '../reviewTypes';
import { applyEulerTransform } from './applyTransform';
import { applyRoll } from './cameraRoll';
import { createModelScene, type ModelScene } from './createModelScene';
import { loadModel } from './loadModel';
import { fitDistance, resizeRendererCamera } from './sceneConfig';
import { createObjectMarker, raycastModelCenter } from './objectHotspot';
import { captureModelCamera, restoreModelCamera } from './modelCamera';
import { useModelAnimations } from './useModelAnimations';
import { useModelLayout } from './useModelLayout';
import { DEFAULT_REVIEW_ASPECT } from '../frameRect';
import { createFlyControls, type FlyControls } from '../viewer/flyControls';
import { frameCameraToSphere, objectBoundingSphere } from '../viewer/frameCamera';
import { useThumbnailCapture } from '../viewer/useThumbnailCapture';
import type { ViewerSceneHandle } from '../viewer/sceneHandle';
import { useFrameShortcuts } from '../viewer/useFrameShortcuts';

interface SceneRuntime {
  scene: ModelScene;
  mixer: THREE.AnimationMixer | null;
  clips: THREE.AnimationClip[];
  /** Caméra « layout » du PiP (mode layout) — pilotée par le lecteur keyframe quand actif. */
  layoutCam: THREE.PerspectiveCamera;
  /** Rayon englobant du modèle chargé — vue d'origine (H) et recadrages. */
  modelRadius: number;
}

/**
 * Viewer modèle 3D **Three.js** (Phase 15) : socle `createModelScene`, chargement GLB, boucle de
 * rendu (damping + mixer), transformation utilisateur, hotspots espace-objet, caméra
 * (capture/restauration, tilt, focale), **navigation unifiée avec le splat** (Phase 17 : orbite +
 * pan, vol clic droit + ZQSD, raccourcis F/H) et **mode layout** (PiP « in/out camera » via
 * `useModelLayout`). Animations extraites dans `useModelAnimations`.
 */
export function useModel3DThree(data: MediaResp | null, glbSrc: string | null) {
  const active = data?.media.kind === 'MODEL_3D';
  const versionId = data?.media.versionId;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<SceneRuntime | null>(null);
  const threeRef = useRef<typeof import('three') | null>(null);
  const hotspotRef = useRef<{ point: THREE.Vector3; objectSpace: boolean } | null>(null);
  const actionRef = useRef<THREE.AnimationAction | null>(null);
  const frameCbs = useRef(new Set<(dt: number) => void>());
  const { onFrame: captureFrame, capture: captureThumbnail } = useThumbnailCapture();
  const flyRef = useRef<FlyControls | null>(null);
  // Aspect du cadre de livraison (présentation persistée) — la caméra le garde quel que soit
  // l'écran, la vue étant étendue au conteneur entier (Phase 25, cf. resizeRendererCamera).
  const frameAspectRef = useRef<number>(DEFAULT_REVIEW_ASPECT);
  frameAspectRef.current = data?.splatPresentation?.camera?.aspect ?? DEFAULT_REVIEW_ASPECT;
  const [ready, setReady] = useState(false);
  const [fov, setFovState] = useState(45);
  const [roll, setRollState] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [savedTf, setSavedTf] = useState(false);

  // Transformation enregistrée sur la version, surchargée par l'édition locale non sauvegardée.
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

  // ── Contrôleur caméra (commun avec le splat) : boucle, canvas, capture/restauration ──
  const subscribeFrame = useCallback((cb: (dt: number) => void) => {
    frameCbs.current.add(cb);
    return () => frameCbs.current.delete(cb);
  }, []);
  const getDom = useCallback(() => runtimeRef.current?.scene.renderer.domElement ?? containerRef.current, []);
  const captureCamera = useCallback(() => {
    const rt = runtimeRef.current;
    const THREE = threeRef.current;
    return rt && THREE ? captureModelCamera(THREE, rt.scene.camera, rt.scene.controls) : undefined;
  }, []);
  const restoreCamera = useCallback((state: unknown) => {
    const rt = runtimeRef.current;
    const THREE = threeRef.current;
    if (rt && THREE) restoreModelCamera(THREE, rt.scene.camera, rt.scene.controls, state);
  }, []);
  const isFlying = useCallback(() => flyRef.current?.flying ?? false, []);

  /** Poignée impérative commune (gizmos, caméra-objet, cadrage) — cf. `viewer/sceneHandle`. */
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
    };
  }, []);

  // Cadrage F/H, unifié avec le splat : F cadre le modèle (direction de vue conservée),
  // H rétablit la vue d'origine (face au modèle, cible au centre).
  const frameView = useCallback(() => {
    const rt = runtimeRef.current;
    const THREE = threeRef.current;
    if (!rt || !THREE) return;
    const bounds = objectBoundingSphere(THREE, rt.scene.root);
    if (bounds) frameCameraToSphere(rt.scene.camera, rt.scene.controls, bounds.center, bounds.radius);
  }, []);
  const homeView = useCallback(() => {
    const rt = runtimeRef.current;
    if (!rt) return;
    const { camera, controls } = rt.scene;
    const dist = fitDistance(rt.modelRadius, camera.fov, camera.aspect || 1);
    if (dist <= 0) return;
    camera.position.set(0, 0, dist);
    controls.target.set(0, 0, 0);
    controls.update();
  }, []);
  useFrameShortcuts({ active: ready, isFlying, onFrame: frameView, onHome: homeView });

  const anim = useModelAnimations(runtimeRef, actionRef);
  const { init: animInit } = anim;
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
      const marker = createObjectMarker(THREE, container);
      let model;
      try {
        model = await loadModel(THREE, new GLTFLoader(), glbSrc);
      } catch {
        if (!cancelled) setLoadError(true);
        scene.dispose();
        marker.remove();
        return;
      }
      if (cancelled) {
        scene.dispose();
        marker.remove();
        return;
      }
      scene.root.add(model.object);
      const mixer = model.animations.length ? new THREE.AnimationMixer(model.object) : null;
      const layoutCam = new THREE.PerspectiveCamera(45, 16 / 9, 0.01, 1000);
      runtimeRef.current = { scene, mixer, clips: model.animations, layoutCam, modelRadius: model.radius };
      animInit(model.animations);
      // Navigation unifiée avec le splat (Phase 17) : vol clic droit + ZQSD/WASD + A/E,
      // pan sur le bouton du milieu (réglé par createFlyControls), orbite au clic gauche.
      const fly = createFlyControls(THREE, scene.camera, scene.controls, scene.renderer.domElement);
      flyRef.current = fly;

      const resize = () =>
        resizeRendererCamera(
          scene.renderer,
          scene.camera,
          container.clientWidth,
          container.clientHeight,
          frameAspectRef.current,
        );
      resize();
      // Cadrage initial (une fois l'aspect connu) + near/far partagés avec la caméra layout.
      const dist = fitDistance(model.radius, scene.camera.fov, scene.camera.aspect || 1);
      if (dist > 0) {
        scene.camera.position.set(0, 0, dist);
        scene.camera.near = layoutCam.near = Math.max(model.radius / 100, 0.001);
        scene.camera.far = layoutCam.far = model.radius * 100;
        scene.camera.updateProjectionMatrix();
        layoutCam.updateProjectionMatrix();
        scene.controls.update();
      }
      const ro = new ResizeObserver(resize);
      ro.observe(container);

      let last = performance.now();
      scene.renderer.setAnimationLoop(() => {
        const now = performance.now();
        const dt = (now - last) / 1000;
        last = now;
        // En vol, la caméra est pilotée par flyControls ; OrbitControls (gelé) ne doit pas
        // la recadrer sur sa cible — sinon le déplacement clavier serait annulé.
        if (fly.flying) fly.update(dt);
        else scene.controls.update();
        mixer?.update(dt);
        frameCbs.current.forEach((cb) => cb(dt));
        scene.renderer.render(scene.scene, scene.camera);
        renderPip(); // PiP de la caméra layout (no-op hors mode layout)
        marker.update(
          hotspotRef.current,
          scene.camera,
          scene.root,
          container.clientWidth,
          container.clientHeight,
        );
        captureFrame(scene.renderer.domElement); // miniature auto (Phase 20)
      });
      setReady(true);
      cleanup = () => {
        ro.disconnect();
        scene.renderer.setAnimationLoop(null);
        fly.dispose();
        flyRef.current = null;
        marker.remove();
        scene.dispose();
      };
    })().catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
      cleanup?.();
      runtimeRef.current = null;
      threeRef.current = null;
      hotspotRef.current = null;
      actionRef.current = null;
    };
  }, [active, glbSrc, animInit, renderPip, captureFrame]);

  // Applique la transformation (orientation + échelle) au groupe parent, en live.
  useEffect(() => {
    const rt = runtimeRef.current;
    if (rt && ready) applyEulerTransform(rt.scene.root, transform);
  }, [transform, ready]);

  const updateTransform = useCallback(
    (patch: Partial<Transform>) => {
      const next = { ...transform, ...patch };
      const rt = runtimeRef.current;
      if (rt) applyEulerTransform(rt.scene.root, next);
      setTfEdit(next);
    },
    [transform],
  );

  const saveTransform = useCallback(async () => {
    if (!versionId) return;
    try {
      await api.patch(`/api/versions/${versionId}`, { transform });
      setSavedTf(true);
      setTimeout(() => setSavedTf(false), 1500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur à l'enregistrement de la transformation");
    }
  }, [versionId, transform]);

  const hotspotAtCenter = useCallback((): Hotspot3D | null => {
    const rt = runtimeRef.current;
    const THREE = threeRef.current;
    return rt && THREE ? raycastModelCenter(THREE, rt.scene.camera, rt.scene.root) : null;
  }, []);

  const showHotspot = useCallback((hs: Hotspot3D | null) => {
    const THREE = threeRef.current;
    if (!hs || !THREE) {
      hotspotRef.current = null;
      return;
    }
    const [x, y, z] = hs.position.split(/\s+/).map((v) => parseFloat(v));
    hotspotRef.current =
      Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
        ? { point: new THREE.Vector3(x, y, z), objectSpace: hs.space === 'object' }
        : null;
  }, []);

  /** Focale (fov) — live (caméra principale). */
  const setFov = useCallback((value: number) => {
    setFovState(value);
    const rt = runtimeRef.current;
    if (!rt) return;
    rt.scene.camera.fov = value;
    rt.scene.camera.updateProjectionMatrix();
  }, []);

  /** Tilt (roll) — oriente `camera.up` selon la direction de vue (mode layout). */
  const setRoll = useCallback((value: number) => {
    setRollState(value);
    const rt = runtimeRef.current;
    const THREE = threeRef.current;
    if (!rt || !THREE) return;
    const forward = new THREE.Vector3().subVectors(rt.scene.controls.target, rt.scene.camera.position);
    applyRoll(THREE, rt.scene.camera, forward, value);
    rt.scene.controls.update();
  }, []);

  const clearLoadError = useCallback(() => setLoadError(false), []);

  return {
    containerRef,
    ready,
    transform,
    updateTransform,
    saveTransform,
    savedTf,
    loadError,
    clearLoadError,
    animations: anim.animations,
    currentAnim: anim.currentAnim,
    playing: anim.playing,
    playAnim: anim.playAnim,
    pauseAnim: anim.pauseAnim,
    selectAnim: anim.selectAnim,
    hotspotAtCenter,
    showHotspot,
    captureThumbnail,
    captureCamera,
    restoreCamera,
    subscribeFrame,
    getDom,
    getSceneHandle,
    isFlying,
    frameView,
    homeView,
    fov,
    setFov,
    roll,
    setRoll,
    layoutMode: layout.layoutMode,
    setLayoutMode: layout.setLayoutMode,
    layoutController: layout.layoutController,
    setPipRect: layout.setPipRect,
  };
}

export type Model3DThreeState = ReturnType<typeof useModel3DThree>;
