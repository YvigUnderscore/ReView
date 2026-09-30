// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cadence de diffusion du lecteur — la valeur dont dérivent **tous** les numéros de frame.
 *
 * La sonde a longtemps arrondi la cadence au centième : 24000/1001 était rangé en base sous
 * la forme `23.98`. L'écart paraît nul et ne l'est pas — 0,003976 frame par seconde, donc
 * une frame entière au bout de quatre minutes, deux au bout de huit. Le « F1247 » d'un
 * superviseur cesse alors de désigner l'image que l'artiste ouvre dans son DCC.
 *
 * La sonde conserve maintenant la fraction exacte (`fpsNum`/`fpsDen`), mais les médias déjà
 * transcodés ne portent que l'arrondi : il faut savoir le relire. C'est possible sans
 * ambiguïté, parce que les cadences fractionnaires forment un ensemble fermé — celles de la
 * télévision NTSC, toutes en /1001. Aucune caméra ne tourne à 23,98 exactement ; un média
 * annoncé à 23.98 est un média à 24000/1001, et rien d'autre.
 */

export interface FrameRateFraction {
  num: number;
  den: number;
}

/** Cadences fractionnaires du monde NTSC — le seul cas où l'arrondi ment. */
export const NTSC_FRAME_RATES: readonly FrameRateFraction[] = [
  { num: 24000, den: 1001 },
  { num: 30000, den: 1001 },
  { num: 48000, den: 1001 },
  { num: 60000, den: 1001 },
  { num: 120000, den: 1001 },
];

/**
 * Tolérance de reconnaissance. L'arrondi au centième déplace la cadence de 0,005 au plus ;
 * la cadence entière voisine, elle, est à 0,024 (24 contre 23,976) ou davantage. Un seuil de
 * 0,02 sépare donc les deux sans jamais confondre 24 avec 23,976.
 */
const MATCH_TOLERANCE = 0.02;

/**
 * Décimales conservées. 23,976 au lieu de 23,976023976… : l'erreur résiduelle vaut
 * 0,000024 frame par seconde, soit une frame après près de six heures de média — hors de
 * portée de tout plan — et la valeur reste lisible partout où elle s'affiche (champ fps de
 * la barre de transport, fiche technique). C'est d'ailleurs la forme qu'écrivent les outils
 * de montage.
 */
const DECIMALS = 3;

const round = (n: number): number => Math.round(n * 10 ** DECIMALS) / 10 ** DECIMALS;

/**
 * Fraction exacte d'une cadence : celle que la sonde a relevée si elle est connue, sinon
 * celle que l'arrondi désigne. `null` quand la cadence est entière (rien à corriger) ou
 * inexploitable.
 */
export function frameRateFraction(
  fps: number | null | undefined,
  probed?: Partial<FrameRateFraction> | null,
): FrameRateFraction | null {
  if (probed && probed.num && probed.den) return { num: probed.num, den: probed.den };
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0) return null;
  return NTSC_FRAME_RATES.find((r) => Math.abs(fps - r.num / r.den) < MATCH_TOLERANCE) ?? null;
}

/**
 * Cadence à utiliser pour convertir un temps en numéro de frame. Rend la valeur d'entrée
 * inchangée quand il n'y a rien à corriger — 25, 24 et 30 sont déjà exacts.
 */
export function exactFrameRate(
  fps: number | null | undefined,
  probed?: Partial<FrameRateFraction> | null,
): number {
  const fraction = frameRateFraction(fps, probed);
  if (fraction) return round(fraction.num / fraction.den);
  return typeof fps === 'number' && Number.isFinite(fps) && fps > 0 ? fps : 24;
}

/**
 * Numéro de frame d'un instant — la conversion unique du lecteur.
 *
 * L'arrondi, et non le plancher : la cadence rendue ici reste approchée de quelques
 * millionièmes, et un plancher transformerait ce millionième en une frame de moins dès que
 * le produit passe juste sous l'entier. L'arrondi ne se trompe qu'au-delà d'une demi-frame
 * d'écart cumulé, soit plusieurs heures de média.
 */
export function frameAtTime(timeSec: number, fps: number): number {
  if (!Number.isFinite(timeSec) || timeSec <= 0 || !Number.isFinite(fps) || fps <= 0) return 0;
  return Math.round(timeSec * fps);
}
