// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import { DEFAULT_TRANSFORM, type MediaResp, type Transform } from '../reviewTypes';
import { applyEulerTransform } from './applyTransform';
import { createModelScene, type ModelScene } from './createModelScene';
import { loadModel } from './loadModel';
import { fitDistance, resizeRendererCamera } from './sceneConfig';
import { createObjectMarker } from './objectHotspot';
import { createSampler, type Sampler } from './statsSampler';
import type { ModelPerfSample } from './perfStats';
import { useModelScale } from './useModelScale';
import { useModelHotspots } from './useModelHotspots';
import { useModelCameraHandles } from './useModelCameraHandles';
import { useModelAnimations } from './useModelAnimations';
import { useModelLayout } from './useModelLayout';
import { DEFAULT_REVIEW_ASPECT } from '../frameRect';
import { createFlyControls, type FlyControls } from '../viewer/flyControls';
import { useThumbnailCapture } from '../viewer/useThumbnailCapture';
import type { ViewerSceneHandle } from '../viewer/sceneHandle';
import { useModelFraming } from './useModelFraming';
import { useSaveTransform } from './useSaveTransform';

export interface SceneRuntime {
  scene: ModelScene;
  mixer: THREE.AnimationMixer | null;
  clips: THREE.AnimationClip[];
  /** Caméra « layout » du PiP (mode layout) — pilotée par le lecteur keyframe quand actif. */
  layoutCam: THREE.PerspectiveCamera;
  /** Rayon englobant du modèle chargé — vue d'origine (H) et recadrages. */
  modelRadius: number;
  /** Centre du modèle normalisé (posé sur `y = 0`) — cible de la vue d'origine et du turntable. */
  modelCenter: THREE.Vector3;
  /** Objet du modèle principal chargé (enfant de `root`) — cible de la comparaison A/B (39.E). */
  modelObject: THREE.Object3D;
  /** Racine glTF (cible du mixer, distincte du wrapper de normalisation — 40.A) ; hôte du
   *  SkeletonHelper (debug squelette 40.B). */
  animRoot: THREE.Object3D;
  /** Nombre de `SkinnedMesh` du modèle (>0 → debug squelette disponible — 40.B). */
  skinnedCount: number;
  /** glTF chargé — variantes de matériaux & caméras embarquées (40.C). */
  gltf: GLTF;
  /** Boîte englobante brute du modèle (unités du fichier) — dimensions réelles et mesure. */
  modelBox: THREE.Box3;
  /** Facteur de normalisation calculé au chargement — conservé pour la bascule taille réelle. */
  normScale: number;
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
  const actionRef = useRef<THREE.AnimationAction | null>(null);
  // Compteurs de performance (FPS, draw calls, triangles) — alimentés par la boucle de rendu,
  // lus par le panneau Scène. Rien n'est mesuré tant que personne n'est abonné.
  const statsRef = useRef<Sampler<ModelPerfSample> | null>(null);
  const { hotspotRef, hotspotAtCenter, hotspotAtPointer, showHotspot } = useModelHotspots({
    runtimeRef,
    threeRef,
  });
  const frameCbs = useRef(new Set<(dt: number) => void>());
  const { onFrame: captureFrame, capture: captureThumbnail } = useThumbnailCapture();
  const flyRef = useRef<FlyControls | null>(null);
  // Aspect du cadre de livraison (présentation persistée) — la caméra le garde quel que soit
  // l'écran, la vue étant étendue au conteneur entier (Phase 25, cf. resizeRendererCamera).
  const frameAspectRef = useRef<number>(DEFAULT_REVIEW_ASPECT);
  frameAspectRef.current = data?.splatPresentation?.camera?.aspect ?? DEFAULT_REVIEW_ASPECT;
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Extensions glTF déclarées par le fichier chargé (fiche technique — 39.C).
  const [extensions, setExtensions] = useState<string[]>([]);
  // Dimensions brutes de la boîte englobante, dans les unités du fichier (mesure, 39.G).
  const [modelSize, setModelSize] = useState<[number, number, number] | null>(null);

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
  // Capture/restauration de la vue (état de vue compris), focale et tilt.
  const { captureCamera, restoreCamera, registerViewState, fov, setFov, roll, setRoll } =
    useModelCameraHandles({ runtimeRef, threeRef });
  const subscribeStats = useCallback(
    (cb: (stats: { fps: number } & ModelPerfSample) => void) => statsRef.current?.subscribe(cb) ?? (() => {}),
    [],
  );
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
      modelObject: rt.modelObject,
      gltf: rt.gltf,
    };
  }, []);

  // `setFrameTarget` (46.I) : la review y branche le prim sélectionné pour que `F` le cadre.
  const { frameView, homeView, setFrameTarget } = useModelFraming({ runtimeRef, threeRef, ready, isFlying });
  // Bascule « taille réelle » (39.G) : le modèle reprend les unités de son fichier. La
  // préférence est rejouée sur chaque modèle chargé via `reapplyScaleRef`.
  const reapplyScaleRef = useRef<(() => void) | null>(null);
  const { realScale, setRealScale } = useModelScale({
    runtimeRef,
    threeRef,
    homeView,
    reapplyRef: reapplyScaleRef,
  });

  const anim = useModelAnimations(runtimeRef, actionRef, threeRef, subscribeFrame);
  // `init` reste privé (appelé au chargement) ; le reste du transport est exposé tel quel.
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
      const marker = createObjectMarker(THREE, container);
      // Compteurs de rendu : `renderer.info` est remis à zéro à chaque frame par Three, on le
      // lit donc à la fin de la boucle, pas à l'abonnement.
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
        marker.remove();
        return;
      }
      if (cancelled) {
        scene.dispose();
        marker.remove();
        return;
      }
      scene.root.add(model.object);
      // Le mixer cible la racine glTF (pas le wrapper de normalisation) : une piste sur le nœud
      // racine ne casse plus le cadrage (40.A).
      const mixer = model.animations.length ? new THREE.AnimationMixer(model.animRoot) : null;
      const layoutCam = new THREE.PerspectiveCamera(45, 16 / 9, 0.01, 1000);
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
      // Dimensions **brutes** du fichier : c'est la seule mesure que la normalisation détruirait
      // si on ne la relevait pas ici (le wrapper, lui, sera rescalé à la demande).
      const raw = model.box.getSize(new THREE.Vector3());
      setModelSize([raw.x, raw.y, raw.z]);
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
      // Cadrage initial (une fois l'aspect connu) + near/far partagés avec la caméra layout. Le
      // modèle repose sur `y = 0` : la caméra vise son centre, pas l'origine (sinon elle regarde
      // le sol et le modèle sort par le haut du cadre).
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
      // Préférence « taille réelle » en cours : rejouée sur ce modèle-ci, cadrage compris — le
      // wrapper vient d'être posé normalisé, l'interrupteur mentirait sinon.
      reapplyScaleRef.current?.();
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
        statsRef.current?.frame(now);
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
      // `ready` doit rester **fidèle** à la présence du runtime : les hooks qui s'abonnent à la
      // scène impérative (scenegraph USD, sélection au clic, caméra-objet) ne peuvent pas
      // deviner que les refs viennent d'être vidées. Sans ce retour à `false`, un changement de
      // `glbSrc` les laisserait branchés sur une scène disparue, et leur effet ne serait jamais
      // rejoué sur la nouvelle.
      setReady(false);
      runtimeRef.current = null;
      threeRef.current = null;
      hotspotRef.current = null;
      actionRef.current = null;
      statsRef.current = null;
    };
  }, [active, glbSrc, animInit, renderPip, captureFrame, hotspotRef]);

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

  const saveTransform = useSaveTransform(versionId, transform, () => setTfEdit(null));

  const clearLoadError = useCallback(() => setLoadError(false), []);

  return {
    containerRef,
    ready,
    extensions,
    transform,
    updateTransform,
    saveTransform,
    /** Transformation modifiée localement et pas encore enregistrée sur la version. */
    tfDirty: tfEdit !== null,
    loadError,
    clearLoadError,
    // Transport d'animation GLB (40.A) : animations, currentAnim, playing, timeMs, durationMs,
    // speed, loop, play, pause, selectAnim, scrub, setSpeed, setLoop.
    ...animApi,
    hotspotAtCenter,
    hotspotAtPointer,
    showHotspot,
    captureThumbnail,
    captureCamera,
    restoreCamera,
    registerViewState,
    subscribeStats,
    subscribeFrame,
    /** Dimensions brutes du modèle (unités du fichier) — `null` tant qu'il n'est pas chargé. */
    modelSize,
    /** Facteur de normalisation courant : 1 en taille réelle, sinon `TARGET_SIZE / maxDim`. */
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
    getActivationView: layout.getActivationView,
  };
}

export type Model3DThreeState = ReturnType<typeof useModel3DThree>;
