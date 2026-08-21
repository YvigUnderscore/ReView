// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Délais maximaux d'une invocation ffmpeg / ffprobe.
 *
 * Une commande ffmpeg qui boucle (conteneur exotique, flux corrompu, filtre qui ne
 * progresse plus) immobilise **définitivement** l'un des deux emplacements de la file
 * `media-processing` : deux fichiers de ce genre arrêtent tout le transcodage du studio,
 * et rien ne le signale. Chaque invocation reçoit donc un délai borné, proportionné à la
 * durée sondée du média quand elle est connue ; passé le délai, le processus est tué et
 * le job échoue avec un message qui nomme l'étape et la limite dépassée.
 *
 * Les bornes sont volontairement larges : il s'agit d'attraper un blocage, pas de couper
 * un encodage lent. Un 4K de dix minutes en libx264 tourne autour de 10× le temps réel ;
 * le facteur retenu laisse le double de cette marge.
 */

/** Sonde ffprobe : lecture d'en-têtes, jamais un travail long. */
export const FFPROBE_TIMEOUT_MS = 60_000;

/** Plancher : couvre les fichiers minuscules dont le coût est dominé par les E/S. */
export const FFMPEG_MIN_TIMEOUT_MS = 5 * 60_000;

/** Plafond absolu : au-delà, c'est un blocage, pas un encodage. */
export const FFMPEG_MAX_TIMEOUT_MS = 6 * 60 * 60_000;

/** Multiple du temps réel accordé à une passe d'encodage. */
export const FFMPEG_REALTIME_FACTOR = 20;

/** Durée inconnue (ffprobe muet, entrée synthétique) : forfait d'une heure. */
export const FFMPEG_UNKNOWN_TIMEOUT_MS = 60 * 60_000;

export interface FfmpegTimeoutOptions {
  /** Multiple du temps réel accordé (défaut : {@link FFMPEG_REALTIME_FACTOR}). */
  factor?: number;
  /** Plancher en millisecondes (défaut : {@link FFMPEG_MIN_TIMEOUT_MS}). */
  minMs?: number;
  /** Plafond en millisecondes (défaut : {@link FFMPEG_MAX_TIMEOUT_MS}). */
  maxMs?: number;
  /** Forfait quand la durée est inconnue (défaut : {@link FFMPEG_UNKNOWN_TIMEOUT_MS}). */
  unknownMs?: number;
}

/**
 * Délai maximal accordé à une invocation ffmpeg pour un média de `durationSec` secondes.
 * Une durée absente, nulle, négative ou non finie retombe sur le forfait.
 */
export function ffmpegTimeoutMs(durationSec?: number | null, opts: FfmpegTimeoutOptions = {}): number {
  const factor = opts.factor ?? FFMPEG_REALTIME_FACTOR;
  const minMs = opts.minMs ?? FFMPEG_MIN_TIMEOUT_MS;
  const maxMs = opts.maxMs ?? FFMPEG_MAX_TIMEOUT_MS;
  const unknownMs = opts.unknownMs ?? FFMPEG_UNKNOWN_TIMEOUT_MS;

  const known = typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0;
  // Le forfait ne passe pas par les bornes : c'est déjà une valeur décidée, pas une
  // extrapolation à corriger.
  if (!known) return Math.round(unknownMs);
  return Math.round(Math.min(maxMs, Math.max(minMs, durationSec * 1000 * factor)));
}

/** Message d'échec d'une commande dépassée — en anglais, comme toutes les erreurs backend. */
export function ffmpegTimeoutMessage(label: string, timeoutMs: number): string {
  return `ffmpeg step "${label}" exceeded its ${Math.round(timeoutMs / 1000)}s time limit and was killed`;
}

/**
 * Erreur distincte d'un échec d'encodage ordinaire : le repli NVENC → libx264 ne doit
 * PAS rejouer une commande qui a expiré (ce n'est pas un encodeur absent, et le repli
 * consommerait une seconde fois le délai avant d'échouer pareillement).
 */
export class FfmpegTimeoutError extends Error {
  readonly label: string;
  readonly timeoutMs: number;

  constructor(label: string, timeoutMs: number) {
    super(ffmpegTimeoutMessage(label, timeoutMs));
    this.name = 'FfmpegTimeoutError';
    this.label = label;
    this.timeoutMs = timeoutMs;
  }
}

/** Vrai si l'erreur vient d'un dépassement de délai (et non d'un encodeur indisponible). */
export const isFfmpegTimeout = (err: unknown): err is FfmpegTimeoutError => err instanceof FfmpegTimeoutError;
