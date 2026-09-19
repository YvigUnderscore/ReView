// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import { createScene, type SplatModules } from './scene/createScene';
import { DEFAULT_REVIEW_ASPECT } from '../frameRect';
import { resizeRendererCamera } from '../three/sceneConfig';
import { createFlyControls } from '../viewer/flyControls';
import { frameCameraToMesh } from './scene/frameCamera';
import { createHotspotMarker } from './scene/hotspotMarker';
import type { PointCloud } from './scene/pointCloud';
import { createStatsSampler, type StatsSampler } from './scene/stats';
import { DEFAULT_CULLING_OFF } from './scene/cullingDefault';
import type { SplatScene, SplatViewer } from './scene/splatViewerTypes';
import { useCameraHandles } from './scene/useCameraHandles';
import { useSplatHandles } from './scene/useSplatHandles';
import { toThumbnail } from '../viewer/thumbnail';
import { applyCulling } from './scene/viewerConfig';
import { renderPipPass, type PipRect } from '../viewer/pipWindow';
import { useRenderGate, SETTLE_WINDOW_MS } from '../viewer/renderScheduler';

// Contrats du viewer (scène, poignée d'édition, API rendue à la page) : définis dans
// `scene/splatViewerTypes`, réexportés ici — l'entrée publique du viewer reste `useSplat`.
export type { SplatSceneHandle, SplatViewer } from './scene/splatViewerTypes';

/**
 * Viewer Gaussian Splat (Spark/SparkJS) — 10.G.
 * Orchestrateur mince : délègue le montage de la scène à `scene/createScene`, l'auto-cadrage à
 * `scene/frameCamera`, le raycast à `scene/raycast` et la miniature à `scene/thumbnail`. Gère
 * ici le cycle de vie React, la boucle de rendu, le marqueur de hotspot et la vue caméra
 * (stockée dans `Comment.cameraState`, comme la review 3D). Aucune dépendance à model-viewer.
 *
 * three + OrbitControls + Spark sont importés dynamiquement (uniquement à l'ouverture d'un
 * splat) pour rester hors du bundle initial — les imports type-only ci-dessus sont erased.
 *
 * Les poignées impératives (raycast, hotspot, miniature, modes de rendu, stats, culling, PiP)
 * vivent dans `scene/useSplatHandles` : elles ne lisent que les refs montées ici.
 */
export function useSplat(url: string | null, fileName: string, frameAspect?: number): SplatViewer {
  const containerRef = useRef<HTMLDivElement>(null);
  // Aspect du cadre de livraison (Phase 25) : la caméra le garde quel que soit l'écran,
  // la vue étant étendue au conteneur entier (setViewOffset, cf. resizeRendererCamera).
  const frameAspectRef = useRef<number>(DEFAULT_REVIEW_ASPECT);
  frameAspectRef.current = frameAspect ?? DEFAULT_REVIEW_ASPECT;
  const sceneRef = useRef<SplatScene | null>(null);
  const threeRef = useRef<typeof import('three') | null>(null);
  // Hotspot à afficher (null = masqué), lu par la boucle de rendu. `objectSpace` : le point
  // est en espace-objet du mesh (V10) et suit sa transformation ; sinon espace monde (ancien).
  const hotspotRef = useRef<{ point: THREE.Vector3; objectSpace: boolean } | null>(null);
  // Résolveur d'une capture de miniature en attente (rempli après le prochain rendu).
  const captureReq = useRef<((d: string | null) => void) | null>(null);
  // Overlay « nuage de points » du mode points (enfant du mesh, construit à la demande) —
  // réactif à la sélection et aux suppressions (setSelection/setHidden).
  const pointsRef = useRef<PointCloud | null>(null);
  // Échantillonneur de stats (FPS, splats) alimenté par la boucle de rendu.
  const statsRef = useRef<StatsSampler | null>(null);
  // Callbacks appelés à chaque frame (dt en secondes) — animation caméra, presets (V5).
  const frameCbs = useRef(new Set<(dt: number) => void>());
  // Contrôles de vol (clic droit + ZQSD) — exposés pour inhiber les raccourcis d'édition (11.G).
  const flyRef = useRef<ReturnType<typeof createFlyControls> | null>(null);
  // Rect de la fenêtre PiP (mode layout, Phase 27) — non-null : 2ᵉ passe de rendu par frame.
  const pipRectRef = useRef<PipRect | null>(null);
  // Rendu à la demande (F14) — porte l'invalidation, le comptage des lecteurs de FPS, la boucle.
  const gate = useRenderGate();
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Progression du téléchargement du fichier splat (41.B) — démarre à 0, passe à null une fois
  // le fichier reçu (le décodage/LOD prend le relais, sans progression mesurable).
  const [progress, setProgress] = useState<number | null>(0);

  useEffect(() => {
    // Pas de reset d'état ici (règle react-hooks/set-state-in-effect) : la page review
    // remonte via `key={mediaId}` à chaque média, donc ready/loadError repartent de false.
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
      // Culling neutralisé par défaut (10.G-V1) : rien ne disparaît en bord de cadre/overscale.
      // Même constante que l'interrupteur du panneau (`useSplatView`) : les deux ne peuvent
      // plus diverger.
      applyCulling(spark, DEFAULT_CULLING_OFF);
      // Navigation fly type Unreal (clic droit + ZQSD/WASD + A/E) — gèle l'orbite en vol.
      const fly = createFlyControls(THREE, camera, controls, renderer.domElement);
      flyRef.current = fly;

      // Marqueur de hotspot (DOM, projeté à l'écran) — n'intercepte pas les events (orbite libre).
      const marker = createHotspotMarker(THREE, container);

      // Auto-cadrage : après chargement, cale caméra + cible sur la bbox du splat (une seule fois).
      let framed = false;
      const onReady = () => {
        if (cancelled) return;
        setProgress(null); // fichier reçu : le décodage/LOD prend le relais (41.B)
        if (!framed) framed = frameCameraToMesh(THREE, mesh, camera, controls);
        // Le nuage continue de se raffiner après `onLoad` (décodage, LOD, premier tri) : on
        // laisse deux secondes de plein régime avant de retomber sur le rendu à la demande.
        gate.invalidate(SETTLE_WINDOW_MS);
        setReady(true);
      };

      // `lod: true` : les données LOD sont construites au chargement (worker WASM) — sans
      // elles, `SparkRenderer.enableLod` est inerte (driveLod filtre sur packedSplats.lodSplats).
      // `nonLod: true` : conserve AUSSI les splats de base (sans lui, le rendu direct — LOD
      // désengagé, notre défaut — est vide). Le LOD ne s'applique que si V7 l'engage.
      // SOG (41.C lecture) : Spark mappe l'extension `.sog`→PCSOGSZIP mais pas `.sogs` — on
      // normalise pour la détection de type (le conteneur zip PCSOGS reste servi tel quel).
      const mesh = new SplatMesh({
        url,
        fileName: fileName.replace(/\.sogs$/i, '.sog'),
        raycastable: true,
        lod: true,
        nonLod: true,
        onLoad: onReady,
        // Progression réseau (41.B) : le GET présigné MinIO renvoie Content-Length → ratio réel.
        onProgress: (e: ProgressEvent) => {
          if (cancelled) return;
          setProgress(e.lengthComputable && e.total > 0 ? Math.min(1, e.loaded / e.total) : null);
        },
      });
      // Orientation à l'import (11.E) : les .ply/.spz gaussians sont généralement Y-down —
      // un groupe parent porte le flip (rotation π sur X), la transform utilisateur restant
      // sur le mesh (gizmo, hotspots et painter suivent matrixWorld, le flip est transparent).
      const pivot = new THREE.Group();
      pivot.rotation.x = Math.PI;
      scene.add(pivot);
      pivot.add(mesh);
      // Caméra layout du PiP (mode layout) : indépendante de la caméra libre, sans viewOffset.
      const layoutCam = new THREE.PerspectiveCamera(camera.fov, 16 / 9, camera.near, camera.far);
      statsRef.current = createStatsSampler(() => ({
        activeSplats: spark.activeSplats,
        totalSplats: mesh.packedSplats?.numSplats ?? 0,
        calls: renderer.info.render.calls,
      }));
      const init = (mesh as unknown as { initialized?: Promise<unknown> }).initialized;
      init?.then(onReady).catch(() => !cancelled && setLoadError(true));

      const resize = () => {
        gate.invalidate(); // `setSize` vide le tampon de dessin : il faut redessiner tout de suite
        const { clientWidth: w, clientHeight: h } = container;
        resizeRendererCamera(renderer, camera, w, h, frameAspectRef.current);
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(container);

      // `update` est joué à chaque tour ; seul `draw` (passes GPU + mesures de mise en page)
      // est sauté quand l'image serait identique — cf. `renderScheduler` pour les garde-fous.
      const stopLoop = gate.start({
        renderer,
        controls,
        isBusy: () => fly.flying || frameCbs.current.size > 0 || !!captureReq.current,
        update: (dt) => {
          // En vol, la caméra est pilotée par flyControls ; OrbitControls (gelé) ne doit pas
          // la recadrer sur sa cible — sinon le déplacement clavier serait annulé.
          if (fly.flying) fly.update(dt);
          else controls.update();
          frameCbs.current.forEach((cb) => cb(dt));
        },
        draw: (now) => {
          renderer.render(scene, camera);
          const { clientWidth: w, clientHeight: h } = container;
          // PiP du mode layout (Phase 27) : vue de la caméra layout dans la fenêtre flottante.
          const pip = pipRectRef.current;
          if (pip) renderPipPass(renderer, scene, layoutCam, pip, w, h);
          statsRef.current?.frame(now);
          // Projette le hotspot monde → pixels et positionne le marqueur (ou le masque).
          marker.update(hotspotRef.current, camera, mesh, w, h);
          // Capture de miniature demandée : le buffer de dessin est intact juste après le rendu.
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
        marker.remove();
      };
    })().catch(() => !cancelled && setLoadError(true));

    return () => {
      cancelled = true;
      cleanup?.();
      sceneRef.current = null;
      threeRef.current = null;
      hotspotRef.current = null;
      pipRectRef.current = null;
      statsRef.current = null;
      frameCallbacks.clear();
      captureReq.current?.(null);
      captureReq.current = null;
    };
  }, [url, fileName, gate]);

  // Handles de pose caméra (capture/restauration vue libre + PiP layout) — hook dédié (budget).
  const { captureCamera, restoreCamera, restorePipCamera } = useCameraHandles(sceneRef, threeRef);

  // Poignées impératives (raycast, hotspot, miniature, transformation, modes, stats, culling,
  // PiP) — hook dédié (budget) : elles ne font que lire les refs montées ci-dessus.
  const handles = useSplatHandles({
    sceneRef,
    threeRef,
    hotspotRef,
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
    ...handles,
  };
}
