/**
 * Affichage du sprite de miniatures de la timeline vidéo : le worker produit UNE image
 * JPEG tuilée (`metadata.timelineSprite`), la timeline la découpe en fond via
 * background-position. Helpers purs, testés.
 */

export interface TimelineSpriteMeta {
  intervalSec: number;
  count: number;
  cols: number;
  rows: number;
  tileW: number;
  tileH: number;
}

export interface SpriteSlot {
  /** Style CSS background pour afficher la vignette `index` à la hauteur demandée. */
  backgroundSize: string;
  backgroundPosition: string;
}

/** Index de vignette pour un instant donné (borné au sprite). */
export function spriteIndexAt(timeSec: number, meta: TimelineSpriteMeta): number {
  const i = Math.floor(Math.max(0, timeSec) / meta.intervalSec);
  return Math.min(meta.count - 1, Math.max(0, i));
}

/** CSS (size + position) pour rendre la vignette `index` dans une case de hauteur `displayH` px. */
export function spriteSlotCss(index: number, meta: TimelineSpriteMeta, displayH: number): SpriteSlot {
  const scale = displayH / meta.tileH;
  const col = index % meta.cols;
  const row = Math.floor(index / meta.cols);
  return {
    backgroundSize: `${meta.cols * meta.tileW * scale}px ${meta.rows * meta.tileH * scale}px`,
    backgroundPosition: `${-col * meta.tileW * scale}px ${-row * meta.tileH * scale}px`,
  };
}

/**
 * Répartition du filmstrip : combien de cases afficher pour une barre de `barWidth` px
 * (cases de ratio vignette, hauteur `displayH`), et l'index de vignette de chaque case
 * (échantillonné sur la durée).
 */
export function filmstripSlots(
  barWidth: number,
  displayH: number,
  durationSec: number,
  meta: TimelineSpriteMeta,
): number[] {
  if (barWidth <= 0 || displayH <= 0 || durationSec <= 0) return [];
  const slotW = Math.max(16, (meta.tileW / meta.tileH) * displayH);
  const n = Math.max(1, Math.floor(barWidth / slotW));
  return Array.from({ length: n }, (_, i) => spriteIndexAt(((i + 0.5) / n) * durationSec, meta));
}
