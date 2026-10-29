// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import {
  describeRejection,
  isSymlinkEntry,
  normalizeEntryName,
  planExtraction,
  resolveInside,
  type ZipEntryInfo,
  type ZipLimits,
} from './zipSafety';

const LIMITS: ZipLimits = { maxEntries: 100, maxTotalBytes: 1024 * 1024 * 1024, maxRatio: 200 };

const file = (name: string, size = 10, compressedSize = 5): ZipEntryInfo => ({
  name,
  size,
  compressedSize,
  isDirectory: false,
});

describe('normalizeEntryName', () => {
  it('normalizes separators and strips neutral segments', () => {
    expect(normalizeEntryName('assets\\tex\\color.png')).toEqual({ path: 'assets/tex/color.png' });
    expect(normalizeEntryName('./scene.usda')).toEqual({ path: 'scene.usda' });
    expect(normalizeEntryName('a//b/./c.usdc')).toEqual({ path: 'a/b/c.usdc' });
  });

  it('rejects absolute paths (Unix, Windows, UNC)', () => {
    expect(normalizeEntryName('/etc/passwd')).toEqual({
      reject: { code: 'ABSOLUTE_PATH', entry: '/etc/passwd' },
    });
    expect(normalizeEntryName('C:\\windows\\system32')).toMatchObject({
      reject: { code: 'ABSOLUTE_PATH' },
    });
    expect(normalizeEntryName('\\\\serveur\\partage\\x')).toMatchObject({
      reject: { code: 'ABSOLUTE_PATH' },
    });
  });

  it('rejects directory traversal and null bytes', () => {
    expect(normalizeEntryName('../../etc/cron.d/x')).toMatchObject({ reject: { code: 'PATH_TRAVERSAL' } });
    expect(normalizeEntryName('assets/../../x')).toMatchObject({ reject: { code: 'PATH_TRAVERSAL' } });
    expect(normalizeEntryName('scene\0.usda')).toMatchObject({ reject: { code: 'PATH_TRAVERSAL' } });
  });
});

describe('isSymlinkEntry', () => {
  it('recognizes a Unix symbolic link in the external attributes', () => {
    expect(isSymlinkEntry((0o120777 << 16) >>> 0)).toBe(true);
  });
  it('accepts ordinary files and directories', () => {
    expect(isSymlinkEntry((0o100644 << 16) >>> 0)).toBe(false);
    expect(isSymlinkEntry((0o040755 << 16) >>> 0)).toBe(false);
  });
  it('tolerates archives without Unix attributes', () => {
    expect(isSymlinkEntry(undefined)).toBe(false);
    expect(isSymlinkEntry(0)).toBe(false);
  });
});

describe('planExtraction', () => {
  it('keeps the files with a normalized name and sums the sizes', () => {
    const plan = planExtraction(
      [
        { name: 'usd/', size: 0, compressedSize: 0, isDirectory: true },
        file('usd\\scene.usda', 1000, 200),
        file('usd/tex/color.png', 500, 400),
      ],
      LIMITS,
    );
    expect(plan.rejection).toBeNull();
    expect(plan.files.map((f) => f.name)).toEqual(['usd/scene.usda', 'usd/tex/color.png']);
    expect(plan.totalBytes).toBe(1500);
  });

  it('rejects the whole archive as soon as an entry leaves the target directory', () => {
    const plan = planExtraction([file('scene.usda'), file('../../evil.sh')], LIMITS);
    expect(plan.rejection).toMatchObject({ code: 'PATH_TRAVERSAL' });
    expect(plan.files).toEqual([]);
  });

  it('rejects symbolic links', () => {
    const plan = planExtraction([{ ...file('link'), externalAttributes: (0o120777 << 16) >>> 0 }], LIMITS);
    expect(plan.rejection).toMatchObject({ code: 'SYMLINK' });
  });

  it('caps the number of entries', () => {
    const entries = Array.from({ length: 5 }, (_, i) => file(`f${i}.usdc`));
    expect(planExtraction(entries, { ...LIMITS, maxEntries: 4 }).rejection).toMatchObject({
      code: 'TOO_MANY_ENTRIES',
      actual: 5,
    });
  });

  it('caps the cumulative uncompressed size', () => {
    const plan = planExtraction([file('a.usdc', 800), file('b.usdc', 800)], {
      ...LIMITS,
      maxTotalBytes: 1000,
    });
    expect(plan.rejection).toMatchObject({ code: 'TOO_LARGE', limit: 1000 });
  });

  it('rejects a decompression bomb above the ratio floor', () => {
    const plan = planExtraction([file('bomb.bin', 64 * 1024 * 1024, 1024)], LIMITS);
    expect(plan.rejection).toMatchObject({ code: 'RATIO' });
  });

  it('ignores the ratio below the floor (small, highly repetitive .usda)', () => {
    expect(planExtraction([file('scene.usda', 1024 * 1024, 8)], LIMITS).rejection).toBeNull();
  });
});

describe('describeRejection', () => {
  it('produces a readable message for each reason', () => {
    expect(describeRejection({ code: 'SYMLINK', entry: 'link' })).toContain('symbolic link');
    expect(describeRejection({ code: 'TOO_LARGE', limit: 2 * 1024 * 1024, actual: 3 })).toContain('2 MB');
    expect(describeRejection({ code: 'RATIO', limit: 200, actual: 5000 })).toContain('×5000');
  });
});

describe('resolveInside', () => {
  const dest = resolve('/tmp/review-extract');

  it('resolves a legitimate entry under the target directory', () => {
    const target = resolveInside(dest, 'usd/scene.usda');
    expect(target).not.toBeNull();
    expect(target!.startsWith(dest)).toBe(true);
  });

  it('returns null for any entry that escapes', () => {
    expect(resolveInside(dest, '../evil')).toBeNull();
    expect(resolveInside(dest, '/etc/passwd')).toBeNull();
  });
});
