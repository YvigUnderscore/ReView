// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { arrowHead, textFontSize, type Shape } from '../../components/annotation/geometry';
import { t } from '../../i18n';

/**
 * Capture & export côté client (menu clic droit de la review, miniatures) :
 * frame vidéo → data URL, copie presse-papiers, téléchargement, réduction miniature.
 * Toutes les fonctions lèvent une Error à message lisible (affichée en toast).
 */

// Épaisseur : les traits sont en px écran (non-scaling) ; à l'export en pleine résolution on
// les remet à l'échelle par rapport à une hauteur d'écran de référence (42.B — №93).
const STROKE_REF_H = 900;

/** Dessine des annotations (coordonnées normalisées 0..1) sur un contexte 2D de `w`×`h` px. */
export function drawAnnotations(ctx: CanvasRenderingContext2D, shapes: Shape[], w: number, h: number): void {
  const scale = h / STROKE_REF_H;
  const X = (x: number) => x * w;
  const Y = (y: number) => y * h;
  for (const s of shapes) {
    ctx.save();
    ctx.globalAlpha = s.alpha ?? 1;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = Math.max(1, s.width * scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (s.type === 'path' || s.type === 'polygon') {
      const pts = s.pts ?? [];
      if (pts.length) {
        ctx.beginPath();
        ctx.moveTo(X(pts[0]![0]!), Y(pts[0]![1]!));
        for (const [x, y] of pts.slice(1)) ctx.lineTo(X(x!), Y(y!));
        if (s.type === 'polygon' && pts.length >= 3) ctx.closePath();
        ctx.stroke();
      }
    } else if (s.type === 'rect') {
      ctx.strokeRect(X(s.x ?? 0), Y(s.y ?? 0), (s.w ?? 0) * w, (s.h ?? 0) * h);
    } else if (s.type === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(
        X(s.cx ?? 0),
        Y(s.cy ?? 0),
        Math.abs((s.rx ?? 0) * w),
        Math.abs((s.ry ?? 0) * h),
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    } else if (s.type === 'arrow') {
      const head = arrowHead(s.x1 ?? 0, s.y1 ?? 0, s.x2 ?? 0, s.y2 ?? 0, { w, h }, s.width * scale);
      const end = head ? head.shaftEnd : [s.x2 ?? 0, s.y2 ?? 0];
      ctx.beginPath();
      ctx.moveTo(X(s.x1 ?? 0), Y(s.y1 ?? 0));
      ctx.lineTo(X(end[0]!), Y(end[1]!));
      ctx.stroke();
      if (head) {
        ctx.beginPath();
        ctx.moveTo(X(head.tip[0]), Y(head.tip[1]));
        ctx.lineTo(X(head.left[0]), Y(head.left[1]));
        ctx.lineTo(X(head.right[0]), Y(head.right[1]));
        ctx.closePath();
        ctx.fill();
      }
    } else if (s.type === 'text') {
      ctx.font = `600 ${textFontSize(s.width) * h}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText(s.text ?? '', X(s.x ?? 0), Y(s.y ?? 0));
    }
    ctx.restore();
  }
}

/** Compose une image (data URL) + ses annotations → nouvelle data URL JPEG (42.B — №93). */
export async function withAnnotations(src: string, shapes: Shape[]): Promise<string> {
  if (!shapes.length) return src;
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  drawAnnotations(ctx, shapes, img.width, img.height);
  return canvas.toDataURL('image/jpeg', 0.9);
}

/** Frame courante d'une vidéo → data URL JPEG. Lève si le canvas est « tainted » (CORS). */
export function captureVideoFrame(video: HTMLVideoElement, quality = 0.88): string {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  if (!canvas.width || !canvas.height) throw new Error(t('capture.notDecoded'));
  canvas.getContext('2d')!.drawImage(video, 0, 0);
  try {
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    throw new Error(t('capture.failed'));
  }
}

/** Réduit une image (data URL ou URL) au gabarit miniature (JPEG ≤ maxWidth px de large). */
export async function toThumbnailDataUrl(src: string, maxWidth = 640): Promise<string> {
  const img = await loadImage(src);
  const scale = Math.min(1, maxWidth / img.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** Fichier image local → data URL miniature (réduit, JPEG). */
export async function fileToThumbnailDataUrl(file: File, maxWidth = 640): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    return await toThumbnailDataUrl(url, maxWidth);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Copie une image (data URL ou URL distante) dans le presse-papiers (PNG). */
export async function copyImageToClipboard(src: string): Promise<void> {
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d')!.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('Encodage PNG impossible');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/** Télécharge une ressource (data URL ou URL distante, via blob pour forcer le download). */
export async function downloadImage(src: string, filename: string): Promise<void> {
  const blob = src.startsWith('data:')
    ? await (await fetch(src)).blob()
    : await (await fetch(src, { mode: 'cors' })).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Chargement de l’image impossible'));
    img.src = src;
  });
}
