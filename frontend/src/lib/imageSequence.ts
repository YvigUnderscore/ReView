// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reconnaissance des séquences d'images au dépôt.
 *
 * Déposer un plan, en VFX, c'est déposer mille fichiers. Sans cette lecture, la file
 * d'upload en fait mille médias : mille vignettes, mille lignes de version, une review
 * impossible. On regarde donc les noms **avant** de lancer quoi que ce soit, et on
 * propose le regroupement — la décision reste à l'utilisateur, jamais prise en silence.
 *
 * La même grammaire vit côté serveur (`backend/src/lib/imageSequence.ts`), qui refait le
 * contrôle sur ce qu'il reçoit : les deux dépôts ne partagent aucun paquet, et un client
 * n'est de toute façon jamais l'autorité sur ce qu'on écrit dans le stockage.
 */

/** En dessous, ce n'est pas une séquence : ce sont des fichiers. */
export const MIN_SEQUENCE_FRAMES = 2;

/**
 * Le numéro de frame est le **dernier** groupe de chiffres avant l'extension.
 *
 * `SH0100_comp_v003.1001.exr` en porte deux : prendre le premier regrouperait tout le plan
 * sous « version 3 ». La capture gourmande, terminée par un caractère non numérique,
 * pousse la frontière aussi loin que possible vers la droite.
 */
const FRAME_NAME = /^(.*[^\d])?(\d+)(\.[A-Za-z0-9]+)$/;

export interface ParsedFrameName {
  base: string;
  number: number;
  digits: number;
  extension: string;
}

export function parseFrameName(name: string): ParsedFrameName | null {
  const m = FRAME_NAME.exec(name);
  if (!m) return null;
  const digits = m[2];
  // Au-delà de neuf chiffres, ce n'est plus une frame mais un identifiant (horodatage).
  if (digits.length > 9) return null;
  return { base: m[1] ?? '', number: Number(digits), digits: digits.length, extension: m[3].toLowerCase() };
}

/** Motif de nommage au format FFmpeg, tel que le serveur l'attend. */
export const framePattern = (base: string, digits: number, extension: string): string =>
  `${base}%0${String(digits)}d${extension}`;

export interface FileSequence {
  /** Motif FFmpeg (`SH0100_comp_v003.%04d.exr`) — deviendra le nom du média. */
  pattern: string;
  extension: string;
  digits: number;
  /** Fichiers triés par numéro de frame. */
  files: File[];
  frames: number[];
  startFrame: number;
  endFrame: number;
  frameCount: number;
  /** Numéros absents entre la première et la dernière frame. */
  missingFrames: number;
  totalSize: number;
}

/**
 * Formats qui peuvent constituer une séquence.
 *
 * Restreint aux images acceptées par l'ingestion (`SUPPORTED_EXTENSIONS[IMAGE]` côté
 * serveur) : sans ce filtre, dix `.mov` numérotés `plan.001.mov` seraient proposés comme
 * une séquence, et le serveur refuserait le lot après coup.
 */
const SEQUENCE_EXTENSIONS = ['.exr', '.dpx', '.tif', '.tiff', '.tga', '.png', '.jpg', '.jpeg'];

/**
 * Regroupe un dépôt en séquences candidates et fichiers isolés.
 *
 * La clé de regroupement est (base, largeur du champ, extension) : `plan.999.exr` et
 * `plan.1000.exr` ne forment pas le même motif FFmpeg, et les fondre produirait un motif
 * que le serveur ne saurait pas relire. Le cas est rare — les studios paddent — et deux
 * propositions distinctes se corrigent d'un clic.
 */
export function detectSequences(files: File[]): { sequences: FileSequence[]; singles: File[] } {
  const buckets = new Map<string, { parsed: ParsedFrameName; file: File }[]>();
  const singles: File[] = [];
  for (const file of files) {
    const parsed = parseFrameName(file.name);
    if (!parsed || !SEQUENCE_EXTENSIONS.includes(parsed.extension)) {
      singles.push(file);
      continue;
    }
    const key = `${parsed.base} ${String(parsed.digits)} ${parsed.extension}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push({ parsed, file });
    else buckets.set(key, [{ parsed, file }]);
  }

  const sequences: FileSequence[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < MIN_SEQUENCE_FRAMES) {
      singles.push(...bucket.map((b) => b.file));
      continue;
    }
    const sorted = [...bucket].sort((a, b) => a.parsed.number - b.parsed.number);
    const { base, digits, extension } = sorted[0].parsed;
    const frames = sorted.map((s) => s.parsed.number);
    const startFrame = frames[0];
    const endFrame = frames[frames.length - 1];
    sequences.push({
      pattern: framePattern(base, digits, extension),
      extension,
      digits,
      files: sorted.map((s) => s.file),
      frames,
      startFrame,
      endFrame,
      frameCount: frames.length,
      missingFrames: endFrame - startFrame + 1 - frames.length,
      totalSize: sorted.reduce((acc, s) => acc + s.file.size, 0),
    });
  }
  sequences.sort((a, b) => a.pattern.localeCompare(b.pattern));
  return { sequences, singles };
}
