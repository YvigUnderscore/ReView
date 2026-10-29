// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import {
  collectPoints,
  isSplatPreviewSupported,
  parsePlyHeader,
  readPoint,
  readSplatCloud,
  samplingStep,
  splatLayout,
} from './splatPoints';

/**
 * Fixtures are hand-built: a minimal Gaussian PLY (positions + `f_dc_*` +
 * `opacity`) and a 32-byte-per-point `.splat`. These are exactly the two formats the
 * thumbnail rasterizer claims to read. If they break, the thumbnail is wrong.
 */

const PLY_PROPS = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity'];

function gaussianPly(points: readonly (readonly number[])[]): Buffer {
  const header = [
    'ply',
    'format binary_little_endian 1.0',
    `element vertex ${points.length}`,
    ...PLY_PROPS.map((p) => `property float ${p}`),
    'end_header',
    '',
  ].join('\n');
  const body = Buffer.alloc(points.length * PLY_PROPS.length * 4);
  points.forEach((row, i) => {
    row.forEach((value, j) => body.writeFloatLE(value, (i * PLY_PROPS.length + j) * 4));
  });
  return Buffer.concat([Buffer.from(header, 'latin1'), body]);
}

function splatFile(points: readonly (readonly number[])[]): Buffer {
  const buf = Buffer.alloc(points.length * 32);
  points.forEach((row, i) => {
    const at = i * 32;
    buf.writeFloatLE(row[0]!, at);
    buf.writeFloatLE(row[1]!, at + 4);
    buf.writeFloatLE(row[2]!, at + 8);
    buf.writeUInt8(row[3]!, at + 24);
    buf.writeUInt8(row[4]!, at + 25);
    buf.writeUInt8(row[5]!, at + 26);
    buf.writeUInt8(row[6]!, at + 27);
  });
  return buf;
}

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'review-splat-test-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('isSplatPreviewSupported', () => {
  it('accepts only containers that are actually readable', () => {
    expect(isSplatPreviewSupported('.ply')).toBe(true);
    expect(isSplatPreviewSupported('.SPLAT')).toBe(true);
    expect(isSplatPreviewSupported('.spz')).toBe(false);
  });
});

describe('parsePlyHeader', () => {
  it('describes the record layout of a binary Gaussian PLY', () => {
    const parsed = parsePlyHeader(gaussianPly([[0, 0, 0, 0, 0, 0, 4]]));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.layout.rowBytes).toBe(28);
    expect(parsed.layout.count).toBe(1);
    expect(parsed.layout.littleEndian).toBe(true);
    expect(parsed.layout.dc).not.toBeNull();
    expect(parsed.layout.alphaScale).toBe('logit');
  });

  it('rejects, with a reason, input that would be misread', () => {
    const ascii = Buffer.from('ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nend_header\n');
    expect(parsePlyHeader(ascii)).toEqual({ ok: false, reason: 'ascii-ply' });

    const compressed = Buffer.from(
      'ply\nformat binary_little_endian 1.0\nelement chunk 1\nproperty float min_x\nend_header\n',
    );
    expect(parsePlyHeader(compressed)).toEqual({ ok: false, reason: 'compressed-ply' });

    expect(parsePlyHeader(Buffer.from('glTF binary'))).toEqual({ ok: false, reason: 'not-a-ply' });
    expect(parsePlyHeader(Buffer.from('ply\nformat binary_little_endian 1.0\n'))).toEqual({
      ok: false,
      reason: 'header-truncated',
    });
  });
});

describe('readPoint', () => {
  it('converts a degree-0 SH coefficient to a color and a logit opacity to alpha', () => {
    const ply = gaussianPly([[1, 2, 3, 1.7724, -1.7724, 0, 4]]);
    const parsed = parsePlyHeader(ply);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const p = readPoint(ply, parsed.layout.dataOffset, parsed.layout);
    expect([p.x, p.y, p.z]).toEqual([1, 2, 3]);
    // 0.5 + C0 * 1.7724 = 1.0 → 255; the opposite coefficient clamps to 0.
    expect(p.r).toBe(255);
    expect(p.b).toBe(128);
    expect(p.g).toBe(0);
    expect(p.a).toBeCloseTo(0.982, 3);
  });
});

describe('samplingStep', () => {
  it('only downsamples when the count exceeds the budget', () => {
    expect(samplingStep(500, 1000)).toBe(1);
    expect(samplingStep(2500, 1000)).toBe(3);
    expect(samplingStep(1000, 0)).toBe(1);
  });
});

describe('collectPoints', () => {
  it('keeps one point per `step` and drops transparent Gaussians', async () => {
    const rows = [
      [0, 0, 0, 0, 0, 0, 5],
      [1, 0, 0, 0, 0, 0, -8], // transparent: dropped
      [2, 0, 0, 0, 0, 0, 5],
      [3, 0, 0, 0, 0, 0, 5],
    ];
    const ply = gaussianPly(rows);
    const parsed = parsePlyHeader(ply);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const all = await collectPoints(
      Readable.from([ply.subarray(parsed.layout.dataOffset)]),
      parsed.layout,
      100,
    );
    expect(all.count).toBe(3);
    expect(Array.from(all.positions.filter((_, i) => i % 3 === 0))).toEqual([0, 2, 3]);

    // Budget of 2 points out of 4 records → every other one, dropping the transparent record.
    const sampled = await collectPoints(
      Readable.from([ply.subarray(parsed.layout.dataOffset)]),
      parsed.layout,
      2,
    );
    expect(sampled.count).toBe(2);
    expect(Array.from(sampled.positions.filter((_, i) => i % 3 === 0))).toEqual([0, 2]);
  });

  it('stitches records split across two chunks of the stream', async () => {
    const ply = gaussianPly([
      [0, 0, 0, 0, 0, 0, 5],
      [1, 1, 1, 0, 0, 0, 5],
    ]);
    const parsed = parsePlyHeader(ply);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const body = ply.subarray(parsed.layout.dataOffset);
    // Deliberately split in the middle of the first record.
    const chunks = [body.subarray(0, 13), body.subarray(13, 40), body.subarray(40)];
    const cloud = await collectPoints(Readable.from(chunks), parsed.layout, 100);
    expect(cloud.count).toBe(2);
    expect(Array.from(cloud.positions)).toEqual([0, 0, 0, 1, 1, 1]);
  });
});

describe('splatLayout', () => {
  it('accepts only a size that is a multiple of 32 bytes', () => {
    expect(splatLayout(64)?.count).toBe(2);
    expect(splatLayout(65)).toBeNull();
    expect(splatLayout(0)).toBeNull();
  });
});

describe('readSplatCloud', () => {
  it('reads a Gaussian PLY from disk', async () => {
    const path = join(root, 'scene.ply');
    const ply = gaussianPly([
      [0, 0, 0, 1.7724, 0, 0, 5],
      [1, 1, 1, 0, 1.7724, 0, 5],
    ]);
    await writeFile(path, ply);
    const read = await readSplatCloud(path, '.ply', ply.length, 100);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.cloud.count).toBe(2);
    expect(read.cloud.colors[0]).toBe(255);
  });

  it('reads a raw `.splat` with 32 bytes per point', async () => {
    const path = join(root, 'scene.splat');
    const buf = splatFile([
      [0, 0, 0, 10, 20, 30, 255],
      [1, 0, 0, 40, 50, 60, 255],
    ]);
    await writeFile(path, buf);
    const read = await readSplatCloud(path, '.splat', buf.length, 100);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.cloud.count).toBe(2);
    expect(Array.from(read.cloud.colors.subarray(0, 3))).toEqual([10, 20, 30]);
  });

  it('returns a reason instead of throwing for anything unreadable', async () => {
    const path = join(root, 'broken.ply');
    await writeFile(path, Buffer.from('not a ply at all'));
    await expect(readSplatCloud(path, '.ply', 16, 100)).resolves.toEqual({
      ok: false,
      reason: 'not-a-ply',
    });
    await expect(readSplatCloud(path, '.spz', 16, 100)).resolves.toEqual({
      ok: false,
      reason: 'unsupported-extension:.spz',
    });
  });

  it('reports a fully transparent cloud instead of producing an empty image', async () => {
    const path = join(root, 'ghost.ply');
    const ply = gaussianPly([[0, 0, 0, 0, 0, 0, -9]]);
    await writeFile(path, ply);
    await expect(readSplatCloud(path, '.ply', ply.length, 100)).resolves.toEqual({
      ok: false,
      reason: 'no-visible-point',
    });
  });
});
