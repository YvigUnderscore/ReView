/**
 * Sprite de miniatures de la timeline vidéo (une vignette ~toutes les 3 s, très légère) :
 * le worker FFmpeg tuile les captures dans UNE image JPEG (`derived/{id}/timeline-sprite.jpg`),
 * décrite par `metadata.timelineSprite` et affichée en fond de timeline côté review.
 */

export interface TimelineSpritePlan {
  /** Intervalle réel entre deux vignettes (s) — étiré si la vidéo est très longue. */
  intervalSec: number;
  /** Nombre de vignettes attendues. */
  count: number;
  cols: number;
  rows: number;
  /** Dimensions d'une vignette (px, pairs — contrainte encodeur). */
  tileW: number;
  tileH: number;
}

const BASE_INTERVAL_SEC = 3;
const MAX_TILES = 240; // ~12 min à 3 s ; au-delà l'intervalle s'étire (sprite bornée)
const TILE_WIDTH = 160;
const MAX_COLS = 10;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Plan du sprite pour une vidéo donnée — null si la durée est inconnue/nulle. */
export function planTimelineSprite(
  durationSec: number | undefined,
  srcWidth: number | undefined,
  srcHeight: number | undefined,
): TimelineSpritePlan | null {
  if (!durationSec || durationSec <= 0) return null;
  let intervalSec = BASE_INTERVAL_SEC;
  let count = Math.max(1, Math.ceil(durationSec / intervalSec));
  if (count > MAX_TILES) {
    intervalSec = Math.ceil(durationSec / MAX_TILES);
    count = Math.max(1, Math.ceil(durationSec / intervalSec));
  }
  const cols = Math.min(count, MAX_COLS);
  const rows = Math.ceil(count / cols);
  const ratio = srcWidth && srcHeight && srcWidth > 0 && srcHeight > 0 ? srcHeight / srcWidth : 9 / 16;
  return { intervalSec, count, cols, rows, tileW: TILE_WIDTH, tileH: even(TILE_WIDTH * ratio) };
}
