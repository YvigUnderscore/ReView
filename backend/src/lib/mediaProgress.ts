// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Progression d'un job média, publiée via `job.updateProgress`.
 *
 * Sans elle, un job bloqué depuis six heures est indiscernable d'un long encodage :
 * le tableau de bord d'administration ne montre qu'un « actif » muet. On découpe donc
 * chaque type de travail en étapes nommées, chacune occupant une plage du pourcentage
 * global, et on interpole à l'intérieur d'une étape avec la progression remontée par
 * ffmpeg. Les plages sont grossièrement proportionnées au coût observé : sur une vidéo,
 * l'échelle HLS pèse la moitié du travail.
 */

export type MediaJobKind = 'transcode' | 'thumbnail' | 'convert3d' | 'trim' | 'scan';

export type MediaJobStep =
  | 'download'
  | 'probe'
  | 'proxy'
  | 'thumbnail'
  | 'renditions'
  | 'client'
  | 'scenes'
  | 'sprite'
  | 'convert'
  | 'trim'
  | 'scan'
  | 'done';

/** État publié sur le job BullMQ (sérialisé tel quel dans Redis). */
export interface MediaJobProgress {
  step: MediaJobStep;
  /** Pourcentage global, entier, 0-100. */
  percent: number;
  /** Rang de la rendition en cours (1-based), quand l'étape est répétée. */
  index?: number;
  /** Nombre total de répétitions de l'étape. */
  total?: number;
}

type Range = readonly [number, number];

/** Plages de pourcentage par type de travail. La somme couvre 0 → 100. */
const RANGES: Record<MediaJobKind, Partial<Record<MediaJobStep, Range>>> = {
  transcode: {
    download: [0, 8],
    probe: [8, 10],
    proxy: [10, 32],
    thumbnail: [32, 36],
    renditions: [36, 84],
    client: [84, 90],
    scenes: [90, 93],
    sprite: [93, 98],
    done: [100, 100],
  },
  thumbnail: {
    download: [0, 30],
    probe: [30, 40],
    thumbnail: [40, 95],
    done: [100, 100],
  },
  convert3d: {
    download: [0, 20],
    convert: [20, 90],
    done: [100, 100],
  },
  trim: {
    download: [0, 20],
    trim: [20, 90],
    done: [100, 100],
  },
  scan: {
    download: [0, 50],
    scan: [50, 95],
    done: [100, 100],
  },
};

export interface MediaProgressOptions {
  /** Rang 0-based de la répétition en cours (renditions HLS). */
  index?: number;
  /** Nombre total de répétitions. */
  total?: number;
  /** Avancement 0→1 à l'intérieur de la répétition courante (progression ffmpeg). */
  fraction?: number;
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/**
 * Pourcentage global au début (`fraction` absente) ou au cours d'une étape.
 * Une étape inconnue pour ce type de travail renvoie 0 : c'est une erreur de
 * programmation, elle ne doit jamais faire échouer un transcodage.
 */
export function mediaJobProgress(
  kind: MediaJobKind,
  step: MediaJobStep,
  opts: MediaProgressOptions = {},
): MediaJobProgress {
  const range = RANGES[kind][step];
  if (!range) return { step, percent: 0 };
  const [from, to] = range;

  const total = opts.total && opts.total > 0 ? opts.total : 1;
  const index = Math.min(Math.max(opts.index ?? 0, 0), total - 1);
  const within = clamp01((index + clamp01(opts.fraction ?? 0)) / total);

  const percent = Math.round(from + (to - from) * within);
  const out: MediaJobProgress = { step, percent };
  if (opts.total && opts.total > 0) {
    out.index = index + 1;
    out.total = opts.total;
  }
  return out;
}

/** Position temporelle d'un `timemark` ffmpeg (« 00:01:23.45 ») en secondes. */
export function parseTimemarkSec(timemark: unknown): number | null {
  if (typeof timemark !== 'string') return null;
  const m = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(timemark.trim());
  if (!m) return null;
  const [h, min, sec] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!Number.isFinite(h) || !Number.isFinite(min) || !Number.isFinite(sec)) return null;
  return h * 3600 + min * 60 + sec;
}

/**
 * Avancement 0→1 d'une commande ffmpeg, d'après son événement `progress`.
 *
 * `percent` n'est renseigné que si fluent-ffmpeg connaît la durée totale — ce qui n'est
 * pas le cas d'une entrée synthétique ni d'un conteneur sans en-tête de durée. On retombe
 * alors sur le `timemark`, rapporté à la durée sondée du média. Sans l'un ni l'autre,
 * `null` : l'appelant garde le pourcentage du début d'étape plutôt que d'inventer.
 */
export function ffmpegFraction(
  progress: { percent?: number | null; timemark?: string | null },
  durationSec?: number,
): number | null {
  const pct = progress.percent;
  if (typeof pct === 'number' && Number.isFinite(pct)) return clamp01(pct / 100);
  const at = parseTimemarkSec(progress.timemark);
  if (at !== null && durationSec !== undefined && durationSec > 0) return clamp01(at / durationSec);
  return null;
}
