import { useCallback, useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SplatMesh } from '@sparkjsdev/spark';
import type { SplatCamera } from './reviewTypes';

/**
 * Viewer Gaussian Splat (Spark/SparkJS) — 10.G.
 * Monte une scène Three.js (WebGL2) avec un `SplatMesh` chargé depuis l'URL présignée,
 * `OrbitControls` pour la navigation, et expose la capture/restauration de la vue caméra
 * (stockée dans `Comment.cameraState`, comme la review 3D). Aucune dépendance à model-viewer.
 *
 * three + OrbitControls + Spark sont importés dynamiquement (uniquement à l'ouverture d'un
 * splat) pour rester hors du bundle initial — les imports ci-dessus sont type-only (erased).
 */
interface SplatScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  mesh: SplatMesh;
}

const asVec = (v: { x: number; y: number; z: number }) => ({ x: v.x, y: v.y, z: v.z });

export interface SplatViewer {
  containerRef: React.RefObject<HTMLDivElement | null>;
  ready: boolean;
  loadError: boolean;
  captureCamera: () => SplatCamera | undefined;
  restoreCamera: (state: unknown) => void;
}

export function useSplat(url: string | null, fileName: string): SplatViewer {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SplatScene | null>(null);
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

      const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 1000);
      camera.position.set(0, 0, 3);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      scene.add(new SparkRenderer({ renderer }));

      const mesh = new SplatMesh({
        url,
        fileName,
        onLoad: () => {
          if (!cancelled) setReady(true);
        },
      });
      scene.add(mesh);
      const init = (mesh as unknown as { initialized?: Promise<unknown> }).initialized;
      init?.then(() => !cancelled && setReady(true)).catch(() => !cancelled && setLoadError(true));

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

      renderer.setAnimationLoop(() => {
        controls.update();
        renderer.render(scene, camera);
      });

      sceneRef.current = { renderer, scene, camera, controls, mesh };
      cleanup = () => {
        ro.disconnect();
        renderer.setAnimationLoop(null);
        controls.dispose();
        (mesh as unknown as { dispose?: () => void }).dispose?.();
        renderer.dispose();
        renderer.domElement.remove();
      };
    })().catch(() => !cancelled && setLoadError(true));

    return () => {
      cancelled = true;
      cleanup?.();
      sceneRef.current = null;
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

  return { containerRef, ready, loadError, captureCamera, restoreCamera };
}
