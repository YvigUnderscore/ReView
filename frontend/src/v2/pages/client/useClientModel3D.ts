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
 * Viewer 3D **en lecture seule** du partage client.
 *
 * Il réutilise tel quel le socle du viewer interne — `createModelScene`, `loadModel`,
 * `resizeRendererCamera`, `createFlyControls`, `applyLighting` — et s'arrête là : pas de
 * gizmo, pas de transformation de version, pas de recomposition, aucune écriture. Ce qui est
 * rejoué, c'est ce que le studio a **persisté** : cadre de livraison, pose caméra, éclairage
 * HDRI, animation embarquée. Aucun appel authentifié : l'invité n'a pas de compte, la seule
 * source de vérité est le payload de partage.
 */
export interface ClientModel3DViewer {
  containerRef: React.RefObject<HTMLDivElement | null>;
  ready: boolean;
  loadError: boolean;
  /** Recadre la vue d'origine (raccourci `H`) — seule commande offerte à l'invité. */
  homeView: () => void;
  /** Poignée impérative vers la scène — consommée par le rejeu de l'override (46.D). */
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

  // Aspect et pose caméra sont lus dans une ref : ils appartiennent au montage de la scène,
  // pas au cycle de rendu React — les relire en dépendance remonterait tout le viewer.
  const aspectRef = useRef(DEFAULT_REVIEW_ASPECT);
  aspectRef.current = clientFrameAspect(source) ?? DEFAULT_REVIEW_ASPECT;
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
      // Animation embarquée (40.A) : un lookdev en turntable doit tourner chez le client
      // comme chez l'artiste. Lecture en boucle du premier clip, sans transport à piloter.
      const mixer = model.animations.length ? new THREE.AnimationMixer(model.animRoot) : null;
      mixer?.clipAction(model.animations[0]).play();

      // Navigation : orbite + pan + vol clic droit, exactement comme la review interne.
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
      // Pose persistée par le studio : elle prime sur le cadrage automatique — c'est elle
      // que le client doit voir en ouvrant le média (« rejouée à l'identique »).
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

  // Éclairage rejoué (HDRI + exposition + rotation + fond + sol d'ombres). L'invité n'a pas
  // accès à `/api/studio/hdris` : l'URL présignée doit venir du payload de partage, sans
  // quoi seuls l'exposition et les lumières neutres s'appliquent.
  const hdriUrl = source?.hdri?.url ?? null;
  const hdriFormat = source?.hdri?.format ?? 'hdr';
  // Champs primitifs plutôt que l'objet : la requête TanStack renvoie un objet neuf à chaque
  // rafraîchissement, et l'effet rechargerait l'HDRI à chaque fois.
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
