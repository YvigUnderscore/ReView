// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Recognition of image sequences on drop.
 *
 * Dropping a shot, in VFX, means dropping a thousand files. Without this reading, the queue
 * would turn it into a thousand media: a thousand thumbnails, a thousand version lines, an unusable review.
 * So we look at the names **before** starting anything, and we
 * propose the grouping: the decision stays with the user, never taken silently.
 *
 * The same grammar lives on the server side (`backend/src/lib/imageSequence.ts`), which repeats the
 * check on what it receives: the two sides share no package, and a client
 * is in any case never the authority on what gets written to storage.
 */

/** Below this, it is not a sequence: they are just files. */
export const MIN_SEQUENCE_FRAMES = 2;

/**
 * The frame number is the **last** group of digits before the extension.
 *
 * `SH0100_comp_v003.1001.exr` has two: taking the first would group the whole shot
 * under "version 3". The greedy capture, ended by a non-numeric character,
 * pushes the boundary as far to the right as possible.
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
  // Beyond nine digits, it is no longer a frame but an identifier (timestamp).
  if (digits.length > 9) return null;
  return { base: m[1] ?? '', number: Number(digits), digits: digits.length, extension: m[3].toLowerCase() };
}

/** Naming pattern in FFmpeg format, as the server expects it. */
export const framePattern = (base: string, digits: number, extension: string): string =>
  `${base}%0${String(digits)}d${extension}`;

export interface FileSequence {
  /** FFmpeg pattern (`SH0100_comp_v003.%04d.exr`): becomes the name of the media. */
  pattern: string;
  extension: string;
  digits: number;
  /** Files sorted by frame number. */
  files: File[];
  frames: number[];
  startFrame: number;
  endFrame: number;
  frameCount: number;
  /** Missing numbers between the first and the last frame. */
  missingFrames: number;
  totalSize: number;
}

/**
 * Formats that can make up a sequence.
 *
 * Restricted to the images accepted by ingestion (`SUPPORTED_EXTENSIONS[IMAGE]` on the
 * server): without this filter, ten `.mov` numbered `shot.001.mov` would be proposed as
 * a sequence, and the server would refuse the batch afterwards.
 */
const SEQUENCE_EXTENSIONS = ['.exr', '.dpx', '.tif', '.tiff', '.tga', '.png', '.jpg', '.jpeg'];

/**
 * Groups a drop into candidate sequences and isolated files.
 *
 * The grouping key is (base, field width, extension): `shot.999.exr` and
 * `shot.1000.exr` do not form the same FFmpeg pattern, and merging them would produce a pattern
 * that the server could not read back. The case is rare (studios pad their numbers), and two
 * distinct proposals are corrected with a single click.
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
