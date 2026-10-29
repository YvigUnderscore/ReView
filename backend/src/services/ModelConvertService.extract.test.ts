// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import AdmZip from 'adm-zip';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractArchive } from './ModelConvertService';

/**
 * Archive extraction: `lib/zipSafety` judges the CATALOGUE (names and *declared* sizes); these tests verify
 * what is actually written to the worker's disk.
 */

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'review-zip-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const archivePath = async (name: string, build: (zip: AdmZip) => void | Promise<void>) => {
  const zip = new AdmZip();
  await build(zip);
  const p = join(dir, name);
  await writeFile(p, zip.toBuffer());
  return p;
};

describe('extractArchive', () => {
  it('extracts an honest archive, folder tree included', async () => {
    const src = await archivePath('honest.zip', (zip) => {
      zip.addFile('scene.usda', Buffer.from('#usda 1.0\n'));
      zip.addFile('tex/albedo.bin', Buffer.alloc(2048, 7));
    });
    const dest = join(dir, 'out-honest');
    await extractArchive(src, dest);
    expect(await readFile(join(dest, 'scene.usda'), 'utf8')).toBe('#usda 1.0\n');
    expect((await readFile(join(dest, 'tex/albedo.bin'))).length).toBe(2048);
  });

  // The core of the fix: the catalogue is supplied by the attacker. An entry announcing 16 bytes while
  // containing 4 MB passed every check of `planExtraction` (declared sizes and ratio),
  // then `extractAllTo` wrote the real bytes without verifying anything.
  it('refuses an entry whose real size contradicts the announced size', async () => {
    const honest = new AdmZip();
    honest.addFile('big.bin', Buffer.alloc(4 * 1024 * 1024, 0));
    const forged = new AdmZip(honest.toBuffer());
    forged.getEntries()[0]!.header.size = 16; // mensonge du catalogue
    const src = join(dir, 'liar.zip');
    await writeFile(src, forged.toBuffer());

    const dest = join(dir, 'out-liar');
    await expect(extractArchive(src, dest)).rejects.toThrow(/Archive extraction failed/);
  });

  // The most insidious variant: announcing ZERO. The real/declared size comparison happens AFTER getData(),
  // which decompresses everything in memory — a zero declaration therefore passed the budget pre-check and
  // offered unbounded decompression. The refusal must happen BEFORE any decompression.
  it('refuses an entry that declares itself empty but is not', async () => {
    const honest = new AdmZip();
    honest.addFile('bomb.bin', Buffer.alloc(4 * 1024 * 1024, 0));
    const forged = new AdmZip(honest.toBuffer());
    forged.getEntries()[0]!.header.size = 0; // "I weigh nothing"
    const src = join(dir, 'zero.zip');
    await writeFile(src, forged.toBuffer());

    const dest = join(dir, 'out-zero');
    await expect(extractArchive(src, dest)).rejects.toThrow(/Archive extraction failed/);
    await expect(readdir(dest)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('accepts a truly empty file', async () => {
    const src = await archivePath('empty.zip', (zip) => {
      zip.addFile('vide.txt', Buffer.alloc(0));
      zip.addFile('scene.usda', Buffer.from('#usda 1.0\n'));
    });
    const dest = join(dir, 'out-empty');
    await extractArchive(src, dest);
    expect((await readFile(join(dest, 'vide.txt'))).length).toBe(0);
  });

  // Regression: the worst case was estimated as `compressedSize × 1032` (DEFLATE's physical expansion). An
  // already compressed file — a texture PNG stored as is — then "weighed"
  // a thousand times its weight and got the entire archive refused: an ordinary glTF scene with its textures
  // was rejected for "decompressed content above 8192 MB".
  it('accepts a large, incompressible entry (stored texture)', async () => {
    const src = await archivePath('stored.zip', (zip) => {
      // Random `Buffer`: incompressible, hence stored as is by adm-zip.
      const noise = Buffer.alloc(12 * 1024 * 1024);
      for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 2654435761) % 251;
      zip.addFile('textures/albedo.png', noise);
      zip.addFile('scene.gltf', Buffer.from('{}'));
    });
    const dest = join(dir, 'out-stored');
    await extractArchive(src, dest);
    expect((await readFile(join(dest, 'textures/albedo.png'))).length).toBe(12 * 1024 * 1024);
  });

  it('refuses an unsupported compression method', async () => {
    const honest = new AdmZip();
    honest.addFile('x.bin', Buffer.alloc(1024, 3));
    const forged = new AdmZip(honest.toBuffer());
    forged.getEntries()[0]!.header.method = 12; // bzip2: outside what we know how to bound
    const src = join(dir, 'method.zip');
    await writeFile(src, forged.toBuffer());

    await expect(extractArchive(src, join(dir, 'out-method'))).rejects.toThrow(/unsupported compression/);
  });

  it('leaves no partial extraction behind a refusal', async () => {
    const honest = new AdmZip();
    honest.addFile('ok.txt', Buffer.from('bien'));
    honest.addFile('big.bin', Buffer.alloc(2 * 1024 * 1024, 0));
    const forged = new AdmZip(honest.toBuffer());
    forged.getEntries().find((e) => e.entryName === 'big.bin')!.header.size = 8;
    const src = join(dir, 'partial.zip');
    await writeFile(src, forged.toBuffer());

    const dest = join(dir, 'out-partial');
    await expect(extractArchive(src, dest)).rejects.toThrow();
    // A half-extracted USD scene would produce a silently incomplete model.
    await expect(readdir(dest)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // Path traversal (`../`, absolute paths, symlinks) is not tested here: adm-zip normalises names at
  // *creation*, so the hostile archive cannot be built with its own API. These cases are covered
  // unit-wise in `lib/zipSafety.test.ts`, on the two functions that the extraction loop applies to each entry
  // — `planExtraction` (catalogue refusal) and `resolveInside` (destination actually written).
});
