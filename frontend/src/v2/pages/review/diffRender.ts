// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, type RefObject } from 'react';

/**
 * Moteur du mode différence A/B (34.E) : |A − B| calculé par le compositing canvas natif
 * (`globalCompositeOperation: 'difference'`, GPU), amplifié par un filtre brightness et
 * optionnellement passé en fausses couleurs (LUT « jet » via filtre SVG inline).
 */

/** Gains d'amplification proposés (×1 = différence brute, souvent invisible). */
export const DIFF_GAINS = [1, 2, 4, 8, 16] as const;

/** Gain suivant du cycle (clic sur le chip ×n). */
export function nextGain(gain: number): number {
  const i = DIFF_GAINS.indexOf(gain as (typeof DIFF_GAINS)[number]);
  return DIFF_GAINS[(i + 1) % DIFF_GAINS.length]!;
}

/**
 * Amplification appliquée dans le contexte 2D. La LUT heatmap ne peut PAS passer par
 * `ctx.filter` : Chrome ignore les filtres SVG référencés (`url(#…)`) dans le canvas 2D —
 * elle s'applique en filtre **CSS sur l'élément canvas** (HEATMAP_CSS_FILTER), supporté.
 */
export function diffFilter(gain: number): string {
  return `brightness(${gain})`;
}

/** Filtre CSS à poser sur l'élément <canvas> quand la heatmap est active. */
export const HEATMAP_CSS_FILTER = 'url(#diff-heatmap-lut)';

type DiffSource = HTMLVideoElement | HTMLImageElement | null;
const sizeOf = (s: Exclude<DiffSource, null>) =>
  'videoWidth' in s ? { w: s.videoWidth, h: s.videoHeight } : { w: s.naturalWidth, h: s.naturalHeight };

/**
 * Boucle rAF de rendu du diff : A puis B en `difference` dans un offscreen, blitté dans
 * le canvas visible avec le filtre d'amplification. Tourne tant que le canvas est monté
 * (drawImage GPU — négligeable pour un pane) : suit lecture, seek et chargement tardif.
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
