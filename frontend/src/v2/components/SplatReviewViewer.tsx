import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

/**
 * Visionneuse Gaussian Splat (SuperSplat vendoré, iframe même-origine).
 *
 * Le viewer expose un pont review (window.reviewGetCameraState / reviewSetCameraState)
 * et signale sa disponibilité via postMessage `{ __reviewReady: true }`. On capture l'état
 * caméra complet — { position[3], angles[3], distance, fov, aspectRatio } — au moment du
 * commentaire, et on le restaure (téléportation OU animation fluide) quand on rouvre.
 *
 * Les annotations 2D sont superposées via `children` (AnnotationCanvas en coordonnées
 * normalisées 0..1) : elles restent calées quelle que soit la taille du viewer, et la
 * restauration de la caméra reproduit le même cadrage pour aligner le dessin.
 */
export interface SplatCameraState {
  position: number[]; angles: number[]; distance?: number; fov?: number; aspectRatio?: number;
  mode?: unknown; // mode caméra du viewer — requis par restoreCameraState
}
export interface SplatViewerHandle {
  getCameraState: () => SplatCameraState | null;
  setCameraState: (state: unknown) => void;
  /** Transition fluide depuis la vue courante vers `state` sur `duration` ms. */
  animateToCameraState: (state: unknown, duration?: number) => void;
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
// Interpolation d'angle par le plus court chemin (degrés), évite les tours complets.
const lerpAngle = (a: number, b: number, t: number) => {
  let d = ((b - a) % 360 + 540) % 360 - 180;
  return a + d * t;
};

const SplatReviewViewer = forwardRef<SplatViewerHandle, { src: string; children?: React.ReactNode }>(
  function SplatReviewViewer({ src, children }, ref) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const readyRef = useRef(false);
    const rafRef = useRef<number | null>(null);

    useEffect(() => {
      readyRef.current = false;
      const onMsg = (e: MessageEvent) => {
        if (iframeRef.current && e.source !== iframeRef.current.contentWindow) return;
        const d = e.data;
        if (d && typeof d === 'object' && (d as { __reviewReady?: boolean }).__reviewReady === true) {
          readyRef.current = true;
        }
      };
      window.addEventListener('message', onMsg);
      return () => { window.removeEventListener('message', onMsg); if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }, [src]);

    const win = () => iframeRef.current?.contentWindow as unknown as {
      reviewGetCameraState?: () => SplatCameraState | null;
      reviewSetCameraState?: (s: unknown) => void;
    } | null;

    const read = (): SplatCameraState | null => {
      const w = win();
      if (readyRef.current && w?.reviewGetCameraState) {
        try { const s = w.reviewGetCameraState(); return s ? JSON.parse(JSON.stringify(s)) : null; } catch { return null; }
      }
      return null;
    };
    const write = (s: unknown) => {
      const w = win();
      if (readyRef.current && w?.reviewSetCameraState && s) { try { w.reviewSetCameraState(s); } catch { /* ignore */ } }
    };

    useImperativeHandle(ref, () => ({
      getCameraState: read,
      setCameraState: write,
      animateToCameraState: (target: unknown, duration = 1000) => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        const to = (typeof target === 'string' ? JSON.parse(target) : target) as SplatCameraState | null;
        const from = read();
        if (!to || !from || !Array.isArray(to.position) || !Array.isArray(to.angles)) { write(to); return; }
        const t0 = performance.now();
        const tick = (now: number) => {
          const k = Math.min(1, (now - t0) / duration);
          const e = easeInOutCubic(k);
          const state: SplatCameraState = {
            position: to.position.map((v, i) => lerp(from.position[i] ?? v, v, e)),
            angles: to.angles.map((v, i) => lerpAngle(from.angles[i] ?? v, v, e)),
            distance: to.distance != null ? lerp(from.distance ?? to.distance, to.distance, e) : from.distance,
            fov: to.fov != null ? lerp(from.fov ?? to.fov, to.fov, e) : from.fov,
            // Le mode caméra doit être présent à chaque frame (restoreCameraState l'exige)
            mode: to.mode ?? from.mode,
          };
          write(state);
          if (k < 1) rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      },
    }), []);

    return (
      <div className="relative h-full w-full">
        <iframe
          ref={iframeRef}
          title="SuperSplat"
          src={src}
          className="h-full w-full border-0"
          allow="xr-spatial-tracking; fullscreen"
        />
        {children}
      </div>
    );
  },
);

export default SplatReviewViewer;
