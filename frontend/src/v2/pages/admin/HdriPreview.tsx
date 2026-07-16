import { useEffect, useRef } from 'react';
import { tonemapToRgba } from './hdriTonemap';

const W = 96;
const H = 48;

/**
 * Aperçu miniature d'un environnement HDRI (.hdr/.exr) — Phase 22. Décodage client
 * (RGBELoader/EXRLoader, imports dynamiques hors bundle initial) puis tonemap Reinhard
 * vers un canvas. Best-effort : en cas d'échec, le canvas reste sombre.
 */
export default function HdriPreview({ url, format }: { url: string; format: 'hdr' | 'exr' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const THREE = await import('three');
        const loader =
          format === 'exr'
            ? new (await import('three/addons/loaders/EXRLoader.js')).EXRLoader().setDataType(THREE.FloatType)
            : new (await import('three/addons/loaders/RGBELoader.js')).RGBELoader().setDataType(
                THREE.FloatType,
              );
        const tex = await loader.loadAsync(url);
        const canvas = canvasRef.current;
        const img = tex.image as { data: ArrayLike<number>; width: number; height: number };
        if (!cancelled && canvas && img?.data) {
          const ctx = canvas.getContext('2d');
          if (ctx)
            ctx.putImageData(
              new ImageData(
                new Uint8ClampedArray(tonemapToRgba(img.data, img.width, img.height, W, H)),
                W,
                H,
              ),
              0,
              0,
            );
        }
        tex.dispose();
      } catch {
        /* aperçu best-effort — la liste reste utilisable sans miniature */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, format]);

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className="h-12 w-24 shrink-0 rounded border border-border bg-black/40"
    />
  );
}
