// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

/**
 * Forme d'onde audio compacte, calculée au transcodage.
 *
 * Le lecteur n'affichait rien du son : la sonde relevait `hasAudio` et personne ne le
 * lisait. Repérer un décalage lèvres/son ou une coupure de dialogue demandait d'écouter
 * la vidéo entière. On produit donc, une fois pour toutes, une **crête par barre** —
 * un octet — plutôt qu'une image : quelques centaines d'octets voyagent avec les
 * métadonnées du média, sans dérivé à stocker ni URL présignée à régénérer.
 *
 * Le flux analysé est du PCM `s16le` mono extrait par ffmpeg (cf. `ffmpeg.worker`), lu
 * en flot : un long-métrage ne tient pas en mémoire à 8 kHz, l'accumulateur si.
 */

/** Fréquence d'échantillonnage du flux PCM mono extrait pour l'analyse. */
export const WAVEFORM_SAMPLE_RATE = 8000;

/** Résolution cible de la forme d'onde : huit barres par seconde, bornée aux extrêmes. */
const BINS_PER_SEC = 8;
const MIN_BINS = 64;
const MAX_BINS = 1200;

/** Forme d'onde rangée dans `metadata.waveform` d'un MediaObject vidéo. */
export interface WaveformMeta {
  version: 1;
  /** Nombre de barres — la barre `i` couvre `[i/bins, (i+1)/bins]` de la durée. */
  bins: number;
  /** Crêtes 0..255, un octet par barre, encodées en base64. */
  peaks: string;
}

/**
 * Nombre de barres pour une durée donnée. `null` quand la durée est inconnue ou nulle :
 * sans elle, aucune barre ne correspond à un instant, la forme d'onde mentirait.
 */
export function planWaveformBins(durationSec: number | undefined): number | null {
  if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec <= 0) return null;
  return Math.min(MAX_BINS, Math.max(MIN_BINS, Math.round(durationSec * BINS_PER_SEC)));
}

const toSigned = (v: number): number => (v >= 0x8000 ? v - 0x10000 : v);

/**
 * Accumulateur de crêtes sur un flux PCM `s16le` mono.
 *
 * Les morceaux lus n'ont aucune raison de tomber sur un nombre pair d'octets : l'octet
 * de poids faible orphelin est retenu (`carry`) et recollé au morceau suivant, sinon un
 * seul chunk impair décalerait d'un octet tout le reste de la piste — soit du bruit.
 */
export class PeakAccumulator {
  private readonly peaks: Uint8Array;
  private readonly totalSamples: number;
  private index = 0;
  private carry: number | null = null;

  constructor(totalSamples: number, bins: number) {
    this.totalSamples = Math.max(1, Math.floor(totalSamples));
    this.peaks = new Uint8Array(Math.max(1, Math.floor(bins)));
  }

  private addSample(value: number): void {
    const bin = Math.min(
      this.peaks.length - 1,
      Math.floor((this.index * this.peaks.length) / this.totalSamples),
    );
    const amp = Math.min(255, Math.round((Math.abs(value) / 32768) * 255));
    if (amp > (this.peaks[bin] ?? 0)) this.peaks[bin] = amp;
    this.index += 1;
  }

  push(chunk: Buffer): void {
    let i = 0;
    if (this.carry !== null && chunk.length > 0) {
      this.addSample(toSigned(((chunk.readUInt8(0) << 8) | this.carry) & 0xffff));
      this.carry = null;
      i = 1;
    }
    for (; i + 1 < chunk.length; i += 2) this.addSample(chunk.readInt16LE(i));
    if (i < chunk.length) this.carry = chunk.readUInt8(i);
  }

  finish(): Uint8Array {
    return this.peaks;
  }
}

/** Encode les crêtes en base64 — un octet par barre. */
export function encodePeaks(peaks: Uint8Array): WaveformMeta {
  return { version: 1, bins: peaks.length, peaks: Buffer.from(peaks).toString('base64') };
}

/**
 * Lit un fichier PCM `s16le` mono et en tire la forme d'onde. Le nombre exact
 * d'échantillons vient de la taille du fichier, pas de la durée sondée : une durée
 * approchée décalerait progressivement les barres par rapport à l'image.
 */
export async function waveformFromPcmFile(path: string, bins: number): Promise<WaveformMeta | null> {
  const { size } = await stat(path);
  const totalSamples = Math.floor(size / 2);
  if (totalSamples <= 0) return null;
  const acc = new PeakAccumulator(totalSamples, bins);
  for await (const chunk of createReadStream(path)) acc.push(chunk as Buffer);
  return encodePeaks(acc.finish());
}
