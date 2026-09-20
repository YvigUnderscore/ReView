// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fond des viewers spatiaux : le renderer est en `alpha: true`, une image tirée du canvas doit
 * donc être aplatie sur ce fond — sans quoi le JPEG sortirait noir et le PNG transparent.
 * Partagé avec la capture de vue (`viewCapture`).
 */
export const VIEWER_BACKDROP = '#0b0b0d';

/**
 * Miniature du splat (10.G) — downscale du canvas WebGL en JPEG (data URL), fond sombre.
 * Fonction pure (aucune dépendance Spark/Three) → testable sans WebGL.
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
  ctx.fillStyle = VIEWER_BACKDROP; // renderer alpha:true → fond sombre pour éviter le noir JPEG
  ctx.fillRect(0, 0, tw, th);
  ctx.drawImage(canvas, 0, 0, tw, th);
  return c2.toDataURL('image/jpeg', 0.72);
}
