// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { tonemapToRgba } from './hdriTonemap';

const W = 96;
const H = 48;

/**
 * Thumbnail preview of an HDRI environment (.hdr/.exr) — Phase 22. Client-side decoding
 * (RGBELoader/EXRLoader, dynamic imports outside the initial bundle), then Reinhard tonemap
 * onto a canvas. Best-effort: on failure, the canvas stays dark.
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
        /* best-effort preview — the list stays usable without a thumbnail */
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
