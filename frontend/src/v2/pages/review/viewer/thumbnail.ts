// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Background of spatial viewers: the renderer uses `alpha: true`, so an image taken from the
 * canvas must be flattened onto this background — otherwise the JPEG would come out black and
 * the PNG transparent. Shared with the view capture (`viewCapture`).
 */
export const VIEWER_BACKDROP = '#0b0b0d';

/**
 * Splat thumbnail (10.G) — downscales the WebGL canvas to a JPEG (data URL) on a dark background.
 * Pure function (no Spark/Three dependency), so it is testable without WebGL.
 *
 * Args:
 *     canvas: Source canvas to downscale.
 *     maxDim: Maximum size in pixels of the longest side.
 *
 * Returns:
 *     The JPEG data URL, or `null` if the canvas has no size or no 2D context is available.
 */
export function toThumbnail(canvas: HTMLCanvasElement, maxDim = 480): string | null {
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
  ctx.fillStyle = VIEWER_BACKDROP; // renderer alpha:true → dark background to avoid a black JPEG
  ctx.fillRect(0, 0, tw, th);
  ctx.drawImage(canvas, 0, 0, tw, th);
  return c2.toDataURL('image/jpeg', 0.72);
}
