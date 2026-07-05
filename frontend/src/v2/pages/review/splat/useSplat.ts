import { useCallback, useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SplatMesh } from '@sparkjsdev/spark';
import type { Hotspot3D, SplatCamera, SplatTransform } from '../reviewTypes';
import { createScene, type SplatModules, type SplatSceneCore } from './scene/createScene';
import { frameCameraToMesh } from './scene/frameCamera';
import { raycastCenter as raycastCenterCore } from './scene/raycast';
import { buildPointCloud, setFalloff, type RenderMode } from './scene/renderModes';
import { toThumbnail } from './scene/thumbnail';

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
  /** Poignée impérative vers la scène (pour les hooks d'édition), ou null si pas encore prête. */
  getSceneHandle: () => SplatSceneHandle | null;
}

export function useSplat(url: string | null, fileName: string): SplatViewer {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SplatScene | null>(null);
  const threeRef = useRef<typeof import('three') | null>(null);
  // Position monde du hotspot à afficher (null = masqué). Lue par la boucle de rendu.
  const hotspotRef = useRef<THREE.Vector3 | null>(null);
  // Résolveur d'une capture de miniature en attente (rempli après le prochain rendu).
  const captureReq = useRef<((d: string | null) => void) | null>(null);
  // Nuage de points du mode « points » (enfant du mesh, construit à la demande).
  const pointsRef = useRef<THREE.Points | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    // Pas de reset d'état ici (règle react-hooks/set-state-in-effect) : la page review
    // remonte via `key={mediaId}` à chaque média, donc ready/loadError repartent de false.
    const container = containerRef.current;
    if (!url || !container) return;

    let cancelled = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      const { SparkRenderer, SplatMesh } = await import('@sparkjsdev/spark');
      if (cancelled || !containerRef.current) return;
      threeRef.current = THREE;

      const modules: SplatModules = { THREE, OrbitControls, SparkRenderer, SplatMesh };
      const { renderer, scene, camera, controls, spark } = createScene(modules, container);

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

      const mesh = new SplatMesh({ url, fileName, raycastable: true, onLoad: onReady });
      scene.add(mesh);
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
      renderer.setAnimationLoop(() => {
        controls.update();
        renderer.render(scene, camera);
        // Projette le hotspot monde → pixels et positionne le marqueur (ou le masque).
        const hs = hotspotRef.current;
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (hs && w > 0 && h > 0) {
          proj.copy(hs).project(camera);
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
      Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? new THREE.Vector3(x, y, z) : null;
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
      dom: s.renderer.domElement,
    };
  }, []);

  const setRenderMode = useCallback((mode: RenderMode) => {
    const s = sceneRef.current;
    const THREE = threeRef.current;
    if (!s || !THREE) return;
    if (mode === 'points') {
      // Masque les splats (opacité 0) mais garde le mesh « visible » pour rendre l'overlay enfant.
      s.mesh.opacity = 0;
      if (!pointsRef.current) {
        pointsRef.current = buildPointCloud(THREE, s.mesh);
        s.mesh.add(pointsRef.current);
      }
      pointsRef.current.visible = true;
    } else {
      s.mesh.opacity = 1;
      if (pointsRef.current) pointsRef.current.visible = false;
      setFalloff(s.spark, mode === 'ellipses' ? 0 : 1);
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
    getSceneHandle,
  };
}
