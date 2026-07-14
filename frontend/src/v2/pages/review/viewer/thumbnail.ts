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
  ctx.fillStyle = '#0b0b0d'; // renderer alpha:true → fond sombre pour éviter le noir JPEG
  ctx.fillRect(0, 0, tw, th);
  ctx.drawImage(canvas, 0, 0, tw, th);
  return c2.toDataURL('image/jpeg', 0.72);
}
