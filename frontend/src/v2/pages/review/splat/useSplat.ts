import { useCallback, useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import type { Hotspot3D, SplatCamera, SplatTransform } from '../reviewTypes';
import { createScene, type SplatModules, type SplatSceneCore } from './scene/createScene';
import { createFlyControls } from './scene/flyControls';
import { frameCameraToMesh } from './scene/frameCamera';
import { raycastCenter as raycastCenterCore } from './scene/raycast';
import { buildPointCloud, ELLIPSES_OPACITY, setFalloff, type RenderMode } from './scene/renderModes';
import { createStatsSampler, type SplatStats, type StatsSampler } from './scene/stats';
import { toThumbnail } from './scene/thumbnail';
import { applyCulling } from './scene/viewerConfig';

/**
 * Viewer Gaussian Splat (Spark/SparkJS) — 10.G.
 * Orchestrateur mince : délègue le montage de la scène à `scene/createScene`, l'auto-cadrage à
 * `scene/frameCamera`, le raycast à `scene/raycast` et la miniature à `scene/thumbnail`. Gère
 * ici le cycle de vie React, la boucle de rendu, le marqueur de hotspot et la vue caméra
 * (stockée dans `Comment.cameraState`, comme la review 3D). Aucune dépendance à model-viewer.
 *
 * three + OrbitControls + Spark sont importés dynamiquement (uniquement à l'ouverture d'un
 * splat) pour rester hors du bundle initial — les imports type-only ci-dessus sont erased.
 */
type SplatScene = SplatSceneCore & { mesh: SplatMesh };

/**
 * Poignée impérative vers la scène Three.js du splat, exposée aux hooks d'édition (gizmos,
 * sélection). Les composants React de haut niveau n'y touchent pas — seule la couche `editor/`
 * consomme Three via cette poignée, gardant la séparation scène / édition.
 */
export interface SplatSceneHandle {
  THREE: typeof import('three');
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  mesh: SplatMesh;
  spark: SparkRenderer;
  dom: HTMLElement;
}

const asVec = (v: { x: number; y: number; z: number }) => ({ x: v.x, y: v.y, z: v.z });

export interface SplatViewer {
  containerRef: React.RefObject<HTMLDivElement | null>;
  ready: boolean;
  loadError: boolean;
  captureCamera: () => SplatCamera | undefined;
  restoreCamera: (state: unknown) => void;
  /** Hotspot sur la surface au centre du viewer (raycast), sinon null si le rayon ne touche rien. */
  raycastCenter: () => Hotspot3D | null;
  /** Affiche (ou masque si null) le marqueur de hotspot, projeté à l'écran à chaque frame. */
  showHotspot: (hs: Hotspot3D | null) => void;
  /** Capture le rendu courant en miniature JPEG (data URL) — résolu après le prochain rendu. */
  captureThumbnail: () => Promise<string | null>;
  /** Applique une transformation TRS au splat — preview live des gizmos et au chargement. */
  applyTransform: (t: SplatTransform | null) => void;
  /** Bascule le mode de visualisation (splats / ellipses gaussiennes / points). */
  setRenderMode: (mode: RenderMode) => void;
  /** Abonne un panneau aux stats de rendu (FPS, splats, draw calls) — mesurées si abonné. */
  subscribeStats: (cb: (stats: SplatStats) => void) => () => void;
  /** Abonne un callback à chaque frame rendue (dt en secondes) — animations caméra (V5). */
  subscribeFrame: (cb: (dt: number) => void) => () => void;
  /** Neutralise (défaut) ou rétablit le culling Spark (clipXY/maxPixelRadius) — réglage live. */
  setCullingOff: (off: boolean) => void;
  /** Poignée impérative vers la scène (pour les hooks d'édition), ou null si pas encore prête. */
  getSceneHandle: () => SplatSceneHandle | null;
}

export function useSplat(url: string | null, fileName: string): SplatViewer {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SplatScene | null>(null);
  const threeRef = useRef<typeof import('three') | null>(null);
  // Hotspot à afficher (null = masqué), lu par la boucle de rendu. `objectSpace` : le point
  // est en espace-objet du mesh (V10) et suit sa transformation ; sinon espace monde (ancien).
  const hotspotRef = useRef<{ point: THREE.Vector3; objectSpace: boolean } | null>(null);
  // Résolveur d'une capture de miniature en attente (rempli après le prochain rendu).
  const captureReq = useRef<((d: string | null) => void) | null>(null);
  // Nuage de points du mode « points » (enfant du mesh, construit à la demande).
  const pointsRef = useRef<THREE.Points | null>(null);
  // Échantillonneur de stats (FPS, splats) alimenté par la boucle de rendu.
  const statsRef = useRef<StatsSampler | null>(null);
  // Callbacks appelés à chaque frame (dt en secondes) — animation caméra, presets (V5).
  const frameCbs = useRef(new Set<(dt: number) => void>());
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);

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
      applyCulling(spark, true);
      // Navigation fly type Unreal (clic droit + ZQSD/WASD + A/E) — gèle l'orbite en vol.
      const fly = createFlyControls(THREE, camera, controls, renderer.domElement);

      // Marqueur de hotspot (DOM, projeté à l'écran) — n'intercepte pas les events (orbite libre).
      const marker = document.createElement('div');
      marker.className =
        'pointer-events-none absolute left-0 top-0 z-[5] flex h-5 w-5 items-center justify-center rounded-full border-2 border-background bg-primary text-[11px] font-semibold text-primary-foreground shadow';
      marker.textContent = '1';
      marker.style.display = 'none';
      container.appendChild(marker);

      // Auto-cadrage : après chargement, cale caméra + cible sur la bbox du splat (une seule fois).
      let framed = false;
      const onReady = () => {
        if (cancelled) return;
        if (!framed) framed = frameCameraToMesh(THREE, mesh, camera, controls);
        setReady(true);
      };

      // `lod: true` : les données LOD sont construites au chargement (worker WASM) — sans
      // elles, `SparkRenderer.enableLod` est inerte (driveLod filtre sur packedSplats.lodSplats).
      // `nonLod: true` : conserve AUSSI les splats de base (sans lui, le rendu direct — LOD
      // désengagé, notre défaut — est vide). Le LOD ne s'applique que si V7 l'engage.
      const mesh = new SplatMesh({
        url,
        fileName,
        raycastable: true,
        lod: true,
        nonLod: true,
        onLoad: onReady,
      });
      scene.add(mesh);
      statsRef.current = createStatsSampler(() => ({
        activeSplats: spark.activeSplats,
        totalSplats: mesh.packedSplats?.numSplats ?? 0,
        calls: renderer.info.render.calls,
      }));
      const init = (mesh as unknown as { initialized?: Promise<unknown> }).initialized;
      init?.then(onReady).catch(() => !cancelled && setLoadError(true));

      const resize = () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w === 0 || h === 0) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(container);

      const proj = new THREE.Vector3();
      let lastFrameMs = performance.now();
      renderer.setAnimationLoop(() => {
        const now = performance.now();
        const dt = (now - lastFrameMs) / 1000;
        lastFrameMs = now;
        // En vol, la caméra est pilotée par flyControls ; OrbitControls (gelé) ne doit pas
        // la recadrer sur sa cible — sinon le déplacement clavier serait annulé.
        if (fly.flying) fly.update(dt);
        else controls.update();
        frameCbs.current.forEach((cb) => cb(dt));
        renderer.render(scene, camera);
        statsRef.current?.frame(now);
        // Projette le hotspot monde → pixels et positionne le marqueur (ou le masque).
        const hs = hotspotRef.current;
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (hs && w > 0 && h > 0) {
          proj.copy(hs.point);
          if (hs.objectSpace) proj.applyMatrix4(mesh.matrixWorld);
          proj.project(camera);
          if (proj.z < 1) {
            const x = (proj.x * 0.5 + 0.5) * w;
            const y = (-proj.y * 0.5 + 0.5) * h;
            marker.style.transform = `translate(${x - 10}px, ${y - 10}px)`;
            marker.style.display = 'flex';
          } else {
            marker.style.display = 'none';
          }
        } else if (marker.style.display !== 'none') {
          marker.style.display = 'none';
        }
        // Capture de miniature demandée : le buffer de dessin est intact juste après le rendu.
        if (captureReq.current) {
          const cb = captureReq.current;
          captureReq.current = null;
          cb(toThumbnail(renderer.domElement));
        }
      });

      sceneRef.current = { renderer, scene, camera, controls, spark, mesh };
      cleanup = () => {
        ro.disconnect();
        renderer.setAnimationLoop(null);
        fly.dispose();
        controls.dispose();
        if (pointsRef.current) {
          pointsRef.current.geometry.dispose();
          (pointsRef.current.material as THREE.Material).dispose();
          pointsRef.current.removeFromParent();
          pointsRef.current = null;
        }
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
      statsRef.current = null;
      frameCallbacks.clear();
      captureReq.current?.(null);
      captureReq.current = null;
    };
  }, [url, fileName]);

  const captureCamera = useCallback((): SplatCamera | undefined => {
    const s = sceneRef.current;
    if (!s) return undefined;
    return {
      position: asVec(s.camera.position),
      target: asVec(s.controls.target),
      fov: s.camera.fov,
      aspect: s.camera.aspect,
    };
  }, []);

  const restoreCamera = useCallback((state: unknown) => {
    const s = sceneRef.current;
    if (!s || !state || typeof state !== 'object') return;
    const c = state as Partial<SplatCamera>;
    if (c.position) s.camera.position.set(c.position.x, c.position.y, c.position.z);
    if (c.fov != null) {
      s.camera.fov = c.fov;
      s.camera.updateProjectionMatrix();
    }
    if (c.target) {
      s.controls.target.set(c.target.x, c.target.y, c.target.z);
      s.controls.update();
    }
  }, []);

  const raycastCenter = useCallback((): Hotspot3D | null => {
    const s = sceneRef.current;
    const THREE = threeRef.current;
    if (!s || !THREE) return null;
    return raycastCenterCore(THREE, s.camera, s.mesh);
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

  const captureThumbnail = useCallback(
    (): Promise<string | null> =>
      new Promise((resolve) => {
        if (!sceneRef.current) resolve(null);
        else captureReq.current = resolve;
      }),
    [],
  );

  const applyTransform = useCallback((t: SplatTransform | null) => {
    const s = sceneRef.current;
    if (!s) return;
    // SplatMesh dérive de THREE.Object3D → position/quaternion/échelle natifs (aucun « editable »).
    // Tolérant : une valeur absente ou d'un ancien format → identité.
    const m = s.mesh;
    if (t && Array.isArray(t.position) && Array.isArray(t.quaternion) && Array.isArray(t.scale)) {
      m.position.fromArray(t.position);
      m.quaternion.fromArray(t.quaternion);
      m.scale.fromArray(t.scale);
    } else {
      m.position.set(0, 0, 0);
      m.quaternion.set(0, 0, 0, 1);
      m.scale.set(1, 1, 1);
    }
  }, []);

  const subscribeStats = useCallback((cb: (stats: SplatStats) => void): (() => void) => {
    // L'échantillonneur existe dès le montage de la scène (avant `ready`) ; les panneaux du
    // HUD ne sont montés qu'une fois le viewer prêt, l'abonnement est donc toujours effectif.
    return statsRef.current?.subscribe(cb) ?? (() => undefined);
  }, []);

  const setCullingOff = useCallback((off: boolean) => {
    const s = sceneRef.current;
    if (s) applyCulling(s.spark, off);
  }, []);

  const subscribeFrame = useCallback((cb: (dt: number) => void): (() => void) => {
    frameCbs.current.add(cb);
    return () => frameCbs.current.delete(cb);
  }, []);

  const getSceneHandle = useCallback((): SplatSceneHandle | null => {
    const s = sceneRef.current;
    const THREE = threeRef.current;
    if (!s || !THREE) return null;
    return {
      THREE,
      scene: s.scene,
      camera: s.camera,
      controls: s.controls,
      mesh: s.mesh,
      spark: s.spark,
      dom: s.renderer.domElement,
    };
  }, []);

  const setRenderMode = useCallback((mode: RenderMode) => {
    const s = sceneRef.current;
    const THREE = threeRef.current;
    if (!s || !THREE) return;
    // L'overlay de points est reconstruit à chaque entrée dans le mode (les suppressions
    // non-destructives entre deux bascules doivent en disparaître).
    if (pointsRef.current) {
      pointsRef.current.geometry.dispose();
      (pointsRef.current.material as THREE.Material).dispose();
      pointsRef.current.removeFromParent();
      pointsRef.current = null;
    }
    if (mode === 'points') {
      // Masque les splats (opacité 0) mais garde le mesh « visible » pour rendre l'overlay enfant.
      s.mesh.opacity = 0;
      pointsRef.current = buildPointCloud(THREE, s.mesh);
      s.mesh.add(pointsRef.current);
    } else if (mode === 'ellipses') {
      // Bordures : ellipses plates (falloff nul) rendues translucides (V2).
      s.mesh.opacity = ELLIPSES_OPACITY;
      setFalloff(s.spark, 0);
    } else {
      s.mesh.opacity = 1;
      setFalloff(s.spark, 1);
    }
  }, []);

  return {
    containerRef,
    ready,
    loadError,
    captureCamera,
    restoreCamera,
    raycastCenter,
    showHotspot,
    captureThumbnail,
    applyTransform,
    setRenderMode,
    subscribeStats,
    subscribeFrame,
    setCullingOff,
    getSceneHandle,
  };
}
