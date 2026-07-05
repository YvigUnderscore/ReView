import { useCallback, useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SplatMesh } from '@sparkjsdev/spark';
import type { Hotspot3D, SplatCamera } from './reviewTypes';

/**
 * Viewer Gaussian Splat (Spark/SparkJS) — 10.G.
 * Monte une scène Three.js (WebGL2) avec un `SplatMesh` chargé depuis l'URL présignée,
 * `OrbitControls` pour la navigation, et expose la capture/restauration de la vue caméra
 * (stockée dans `Comment.cameraState`, comme la review 3D). Aucune dépendance à model-viewer.
 *
 * Hotspots de surface (10.G) : le SplatMesh est `raycastable` ; `raycastCenter()` lance un
 * rayon au centre du viewer et renvoie un `Hotspot3D` (position + normale face caméra).
 * `showHotspot()` affiche un marqueur DOM projeté monde→écran à chaque frame.
 *
 * three + OrbitControls + Spark sont importés dynamiquement (uniquement à l'ouverture d'un
 * splat) pour rester hors du bundle initial — les imports ci-dessus sont type-only (erased).
 */
type ThreeModule = typeof import('three');

interface SplatScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  mesh: SplatMesh;
}

const asVec = (v: { x: number; y: number; z: number }) => ({ x: v.x, y: v.y, z: v.z });

/** Downscale le canvas WebGL en JPEG (data URL) pour une miniature légère (fond sombre). */
function toThumbnail(canvas: HTMLCanvasElement, maxDim = 480): string | null {
  const { width, height } = canvas;
  if (!width || !height) return null;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  const tw = Math.max(1, Math.round(width * scale));
  const th = Math.max(1, Math.round(height * scale));
  const c2 = document.createElement('canvas');
  c2.width = tw;
  c2.height = th;
  const ctx = c2.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#0b0b0d'; // renderer alpha:true → fond sombre pour éviter le noir JPEG
  ctx.fillRect(0, 0, tw, th);
  ctx.drawImage(canvas, 0, 0, tw, th);
  return c2.toDataURL('image/jpeg', 0.72);
}

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
}

export function useSplat(url: string | null, fileName: string): SplatViewer {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SplatScene | null>(null);
  const threeRef = useRef<ThreeModule | null>(null);
  // Position monde du hotspot à afficher (null = masqué). Lue par la boucle de rendu.
  const hotspotRef = useRef<THREE.Vector3 | null>(null);
  // Résolveur d'une capture de miniature en attente (rempli après le prochain rendu).
  const captureReq = useRef<((d: string | null) => void) | null>(null);
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

      const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';
      container.appendChild(renderer.domElement);

      // Marqueur de hotspot (DOM, projeté à l'écran) — n'intercepte pas les events (orbite libre).
      const marker = document.createElement('div');
      marker.className =
        'pointer-events-none absolute left-0 top-0 z-[5] flex h-5 w-5 items-center justify-center rounded-full border-2 border-background bg-primary text-[11px] font-semibold text-primary-foreground shadow';
      marker.textContent = '1';
      marker.style.display = 'none';
      container.appendChild(marker);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 1000);
      camera.position.set(0, 0, 3);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      scene.add(new SparkRenderer({ renderer }));

      // Auto-cadrage : après chargement, cale caméra + cible OrbitControls sur la bbox du
      // splat (une seule fois — l'utilisateur oriente ensuite librement à l'orbite).
      let framed = false;
      const frameCamera = () => {
        if (framed) return;
        try {
          const box = mesh.getBoundingBox(true); // centres uniquement (robuste aux splats aberrants)
          if (box.isEmpty()) return;
          const center = box.getCenter(new THREE.Vector3());
          const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
          if (!Number.isFinite(radius) || radius <= 0) return;
          // Distance pour faire tenir la sphère dans le plus contraint des FOV (portrait inclus).
          const vFov = (camera.fov * Math.PI) / 180;
          const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (camera.aspect || 1));
          const dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.2;
          camera.position.copy(center).add(new THREE.Vector3(0, 0, dist));
          camera.near = Math.max(radius / 100, 0.001);
          camera.far = radius * 100;
          camera.updateProjectionMatrix();
          controls.target.copy(center);
          controls.update();
          framed = true;
        } catch {
          // bbox indisponible → on conserve la position par défaut (0,0,3).
        }
      };
      const onReady = () => {
        if (cancelled) return;
        frameCamera();
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

      sceneRef.current = { renderer, scene, camera, controls, mesh };
      cleanup = () => {
        ro.disconnect();
        renderer.setAnimationLoop(null);
        controls.dispose();
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
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), s.camera); // centre du viewer (NDC 0,0)
    const hits: { distance: number; point: THREE.Vector3; object: THREE.Object3D }[] = [];
    s.mesh.raycast(raycaster, hits);
    if (hits.length === 0) return null;
    hits.sort((a, b) => a.distance - b.distance);
    const p = hits[0]!.point;
    // Pas de normale de surface pour un splat → normale face caméra (usage : compat/orientation).
    const n = s.camera.position.clone().sub(p).normalize();
    return { position: `${p.x} ${p.y} ${p.z}`, normal: `${n.x} ${n.y} ${n.z}` };
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

  return {
    containerRef,
    ready,
    loadError,
    captureCamera,
    restoreCamera,
    raycastCenter,
    showHotspot,
    captureThumbnail,
  };
}
