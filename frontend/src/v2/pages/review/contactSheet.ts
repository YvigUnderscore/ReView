import { formatTime } from './reviewTypes';
import type { TimelineSpriteMeta } from './timelineSprite';

/**
 * Planche contact exportable (34.H) : compose un PNG à partir du sprite de timeline
 * (grille de vignettes déjà produite par le worker) — bandeau titre + timecode sous
 * chaque vignette. 100 % client (canvas), déclenché par le menu clic droit.
 */

export interface ContactSheetLayout {
  width: number;
  height: number;
  /** Hauteur du bandeau titre. */
  header: number;
  /** Hauteur de la zone timecode sous chaque vignette. */
  labelH: number;
  /** Marge intérieure autour de la grille et entre cellules. */
  gap: number;
  /** Position du coin haut-gauche de la vignette `i` (hors label). */
  cell: (i: number) => { x: number; y: number };
}

/** Géométrie de la planche (pure, testée) : grille du sprite + bandeau + labels. */
export function contactSheetLayout(meta: TimelineSpriteMeta): ContactSheetLayout {
  const header = 44;
  const labelH = 18;
  const gap = 8;
  const rows = Math.ceil(meta.count / meta.cols);
  const cellH = meta.tileH + labelH;
  return {
    width: gap + meta.cols * (meta.tileW + gap),
    height: header + gap + rows * (cellH + gap),
    header,
    labelH,
    gap,
    cell: (i) => ({
      x: gap + (i % meta.cols) * (meta.tileW + gap),
      y: header + gap + Math.floor(i / meta.cols) * (cellH + gap),
    }),
  };
}

/** Compose la planche et renvoie un data URL PNG (le sprite doit être CORS-lisible). */
export async function buildContactSheet(
  spriteUrl: string,
  meta: TimelineSpriteMeta,
  title: string,
): Promise<string> {
  const sprite = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Sprite de timeline inaccessible'));
    img.src = spriteUrl;
  });
  const layout = contactSheetLayout(meta);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');
  ctx.fillStyle = '#0b1020';
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = '#e6edf7';
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, layout.gap, layout.header / 2);
  ctx.font = '11px ui-monospace, monospace';
  for (let i = 0; i < meta.count; i++) {
    const { x, y } = layout.cell(i);
    const sx = (i % meta.cols) * meta.tileW;
    const sy = Math.floor(i / meta.cols) * meta.tileH;
    ctx.drawImage(sprite, sx, sy, meta.tileW, meta.tileH, x, y, meta.tileW, meta.tileH);
    ctx.fillStyle = '#93a4bd';
    ctx.fillText(formatTime(i * meta.intervalSec), x, y + meta.tileH + layout.labelH / 2);
    ctx.fillStyle = '#e6edf7';
  }
  return canvas.toDataURL('image/png');
}
