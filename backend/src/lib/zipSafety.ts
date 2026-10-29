// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { join, normalize, resolve, sep } from 'node:path';

/**
 * Bounded archive extraction, without traversal (Phase 45, 45.A). **Pure and testable** logic: the
 * decision is taken from the archive's **catalog** (names and announced sizes), whether extraction
 * is acceptable, BEFORE writing a single byte to the worker's disk.
 *
 * Three families of attack are covered:
 *  - **zip-slip**: an entry named `../../etc/cron.d/x` is written outside the target directory;
 *  - **symbolic links**: a symlink entry pointing to `/` turns the next extraction into an arbitrary
 *    write (adm-zip does not materialize symlinks, but we refuse them on principle);
 *  - **decompression bomb**: a few KB compressed that weigh terabytes once extracted.
 *
 * **All-or-nothing** decision: a single suspicious entry invalidates the whole archive. Extracting a
 * USD scene partially would silently produce an incomplete model: worse than an error.
 */

/** Archive entry as described by the central catalog of the zip. */
export interface ZipEntryInfo {
  /** Path declared in the archive (`/` or `\` separators, not cleaned). */
  name: string;
  /** Announced uncompressed size. */
  size: number;
  /** Announced compressed size. */
  compressedSize: number;
  /** "Directory" entry (no content to write). */
  isDirectory: boolean;
  /** External attributes of the zip: the Unix mode occupies the high 16 bits (symlink detection). */
  externalAttributes?: number;
}

/** Extraction bounds (configurable, see `config/env.ts`). */
export interface ZipLimits {
  /** Maximum number of entries (a large USD scene stays under a few thousand). */
  maxEntries: number;
  /** Maximum cumulative uncompressed size, in bytes. */
  maxTotalBytes: number;
  /** Maximum tolerated overall compression ratio (uncompressed / compressed). */
  maxRatio: number;
}

/** Reason an archive is refused, passed up as is to the user (short message, no absolute path). */
export type ZipRejection =
  | { code: 'ABSOLUTE_PATH'; entry: string }
  | { code: 'PATH_TRAVERSAL'; entry: string }
  | { code: 'SYMLINK'; entry: string }
  | { code: 'TOO_MANY_ENTRIES'; limit: number; actual: number }
  | { code: 'TOO_LARGE'; limit: number; actual: number }
  | { code: 'RATIO'; limit: number; actual: number };

/** Planning result: either the files to extract, or a reasoned refusal. */
export interface ExtractionPlan {
  /** "File" entries kept (directories are recreated implicitly). */
  files: ZipEntryInfo[];
  /** Sum of the announced uncompressed sizes. */
  totalBytes: number;
  /** Non-null means the archive is refused; `files` is then empty. */
  rejection: ZipRejection | null;
}

/**
 * Below this uncompressed volume, the ratio check is ignored: a small, highly repetitive file (an
 * ASCII `.usda`, for example) legitimately compresses at 1:1000 without being a bomb.
 */
const RATIO_FLOOR_BYTES = 8 * 1024 * 1024;

/** File-type mask in a Unix mode, and the value corresponding to a symbolic link. */
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/** True if the zip's external attributes describe a Unix symbolic link. */
export function isSymlinkEntry(externalAttributes: number | undefined): boolean {
  if (typeof externalAttributes !== 'number' || externalAttributes === 0) return false;
  // The high 16 bits carry the Unix mode when the archive was created under Unix.
  const mode = (externalAttributes >>> 16) & 0xffff;
  return (mode & S_IFMT) === S_IFLNK;
}

/**
 * Normalizes an entry name into a relative POSIX path, or returns the reason for refusal.
 * Refuses absolute paths (`/x`, `C:\x`, UNC), `..` segments and null bytes.
 */
export function normalizeEntryName(name: string): { path: string } | { reject: ZipRejection } {
  if (name.includes('\0')) return { reject: { code: 'PATH_TRAVERSAL', entry: name } };
  const unified = name.replace(/\\/g, '/');
  if (unified.startsWith('/') || /^[A-Za-z]:\//.test(unified) || unified.startsWith('//'))
    return { reject: { code: 'ABSOLUTE_PATH', entry: name } };
  const segments = unified.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.some((s) => s === '..')) return { reject: { code: 'PATH_TRAVERSAL', entry: name } };
  return { path: segments.join('/') };
}

/**
 * Decides on the extraction of an archive from its catalog. Returns the retained file entries
 * (name normalized to a relative POSIX path) or a reasoned refusal, never both.
 */
export function planExtraction(entries: ZipEntryInfo[], limits: ZipLimits): ExtractionPlan {
  const reject = (rejection: ZipRejection): ExtractionPlan => ({ files: [], totalBytes: 0, rejection });

  if (entries.length > limits.maxEntries)
    return reject({ code: 'TOO_MANY_ENTRIES', limit: limits.maxEntries, actual: entries.length });

  const files: ZipEntryInfo[] = [];
  let totalBytes = 0;
  let compressedBytes = 0;

  for (const entry of entries) {
    const normalized = normalizeEntryName(entry.name);
    if ('reject' in normalized) return reject(normalized.reject);
    // The symlink check runs after normalization: a symlink named `../x` must be reported as a
    // traversal (the most explicit reason for the user).
    if (isSymlinkEntry(entry.externalAttributes)) return reject({ code: 'SYMLINK', entry: entry.name });
    if (entry.isDirectory) continue;

    totalBytes += Math.max(0, entry.size);
    compressedBytes += Math.max(0, entry.compressedSize);
    if (totalBytes > limits.maxTotalBytes)
      return reject({ code: 'TOO_LARGE', limit: limits.maxTotalBytes, actual: totalBytes });

    files.push({ ...entry, name: normalized.path });
  }

  if (totalBytes > RATIO_FLOOR_BYTES && compressedBytes > 0) {
    const ratio = totalBytes / compressedBytes;
    if (ratio > limits.maxRatio)
      return reject({ code: 'RATIO', limit: limits.maxRatio, actual: Math.round(ratio) });
  }

  return { files, totalBytes, rejection: null };
}

/** Short, readable message for an archive refusal. */
export function describeRejection(rejection: ZipRejection): string {
  switch (rejection.code) {
    case 'ABSOLUTE_PATH':
      return `Archive refused: absolute path forbidden (${rejection.entry})`;
    case 'PATH_TRAVERSAL':
      return `Archive refused: path escaping the archive (${rejection.entry})`;
    case 'SYMLINK':
      return `Archive refused: symbolic link forbidden (${rejection.entry})`;
    case 'TOO_MANY_ENTRIES':
      return `Archive refused: ${rejection.actual} entries (maximum ${rejection.limit})`;
    case 'TOO_LARGE':
      return `Archive refused: uncompressed content larger than ${Math.round(rejection.limit / 1024 / 1024)} MB`;
    case 'RATIO':
      return `Archive refused: abnormal compression ratio (×${rejection.actual}, maximum ×${rejection.limit})`;
  }
}

/**
 * Destination path of an entry, guaranteed to be **inside** `destDir`. Returns `null` if the
 * resolution escapes it: a double safety at write time, after `planExtraction`.
 */
export function resolveInside(destDir: string, entryName: string): string | null {
  const normalized = normalizeEntryName(entryName);
  if ('reject' in normalized) return null;
  const base = resolve(destDir);
  const target = resolve(join(base, normalize(normalized.path)));
  if (target !== base && !target.startsWith(base + sep)) return null;
  return target;
}
