// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, type RefObject } from 'react';

/**
 * A/B difference mode engine (34.E): |A − B| computed by native canvas compositing
 * (`globalCompositeOperation: 'difference'`, GPU), amplified by a brightness filter and
 * optionally shown in false colours (a "jet" LUT via an inline SVG filter).
 */

/** Proposed amplification gains (×1 = raw difference, often invisible). */
export const DIFF_GAINS = [1, 2, 4, 8, 16] as const;

/** Next gain in the cycle (click on the ×n chip). */
export function nextGain(gain: number): number {
  const i = DIFF_GAINS.indexOf(gain as (typeof DIFF_GAINS)[number]);
  return DIFF_GAINS[(i + 1) % DIFF_GAINS.length];
}

/**
 * Amplification applied in the 2D context. The heatmap LUT cannot go through `ctx.filter`:
 * Chrome ignores SVG filters referenced via `url(#…)` in the 2D canvas. It is applied as a
 * **CSS filter on the canvas element** (HEATMAP_CSS_FILTER), which is supported.
 */
export function diffFilter(gain: number): string {
  return `brightness(${gain})`;
}

/** CSS filter to set on the <canvas> element when the heatmap is active. */
export const HEATMAP_CSS_FILTER = 'url(#diff-heatmap-lut)';

type DiffSource = HTMLVideoElement | HTMLImageElement | null;
const sizeOf = (s: Exclude<DiffSource, null>) =>
  'videoWidth' in s ? { w: s.videoWidth, h: s.videoHeight } : { w: s.naturalWidth, h: s.naturalHeight };

/**
 * rAF render loop of the diff: A then B in `difference` in an offscreen canvas, blitted into
 * the visible canvas with the amplification filter. Runs as long as the canvas is mounted
 * (GPU drawImage, negligible for one pane): follows playback, seek and late loading.
 */
export function useDiffDraw(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  getA: () => DiffSource,
  getB: () => DiffSource,
  gain: number,
) {
  useEffect(() => {
    const off = document.createElement('canvas');
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const a = getA();
      const b = getB();
      if (!canvas || !a || !b) return;
      const { w, h } = sizeOf(a);
      if (!w || !h) return;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      if (off.width !== w) off.width = w;
      if (off.height !== h) off.height = h;
      const octx = off.getContext('2d');
      const ctx = canvas.getContext('2d');
      if (!octx || !ctx) return;
      octx.globalCompositeOperation = 'source-over';
      octx.drawImage(a, 0, 0, w, h);
      octx.globalCompositeOperation = 'difference';
      octx.drawImage(b, 0, 0, w, h);
      ctx.filter = diffFilter(gain);
      ctx.drawImage(off, 0, 0);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [canvasRef, getA, getB, gain]);
}
