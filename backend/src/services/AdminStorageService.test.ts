// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, it, expect, vi } from 'vitest';

// Pure functions under test: env/DB dependencies of the imports are stubbed out. The bucket scan and
// the Project table are doubled: what matters here is the operations (how many sweeps, how many objects
// retained), not real bytes.
const mocks = vi.hoisted(() => ({
  iterateObjects: vi.fn<() => AsyncIterable<{ key: string; size: number }>>(),
  findMany: vi.fn<() => Promise<{ id: number; slug: string; name: string; deletedAt: Date | null }[]>>(),
}));
vi.mock('../lib/prisma', () => ({ prisma: { project: { findMany: mocks.findMany } } }));
vi.mock('./StorageService', () => ({ storage: { iterateObjects: mocks.iterateObjects } }));

import {
  classifyKey,
  derivedSubtype,
  aggregateObjects,
  aggregateObjectsStream,
  resetStorageReportCache,
  storageReport,
  STORAGE_REPORT_TTL_MS,
} from './AdminStorageService';

describe('AdminStorageService — classifyKey', () => {
  it('classifies originals under their project slug', () => {
    expect(classifyKey('projects/demo-film/SQ010-SH020/V01/42/plate.mov')).toEqual({
      category: 'originals',
      projectSlug: 'demo-film',
    });
  });

  it('classifies derivatives under their subtype', () => {
    expect(classifyKey('derived/42/hls/master.m3u8')).toEqual({ category: 'derived', sub: 'hls' });
    expect(classifyKey('derived/42/thumbnail.webp')).toEqual({ category: 'derived', sub: 'thumbnails' });
    expect(classifyKey('derived/42/model.glb')).toEqual({ category: 'derived', sub: 'glb' });
    expect(classifyKey('derived/42/splat-mask.bin')).toEqual({ category: 'derived', sub: 'splat-edits' });
  });

  it('classifies studio libraries, avatars and quarantine', () => {
    expect(classifyKey('studio/hdris/abc.exr')).toEqual({ category: 'studio', sub: 'hdris' });
    expect(classifyKey('studio/ocio/abc.ocio')).toEqual({ category: 'studio', sub: 'ocio' });
    expect(classifyKey('avatars/7.png')).toEqual({ category: 'avatars' });
    expect(classifyKey('quarantine/42/virus.mov')).toEqual({ category: 'quarantine' });
    expect(classifyKey('comments/attachments/3/note.webm')).toEqual({ category: 'comments' });
  });

  it('puts unknown keys under other', () => {
    expect(classifyKey('tmp/whatever.bin').category).toBe('other');
  });
});

describe('AdminStorageService — derivedSubtype', () => {
  it('recognises each derivative produced by the FFmpeg worker', () => {
    expect(derivedSubtype('proxy.mp4')).toBe('proxies');
    expect(derivedSubtype('proxy-trim.mp4')).toBe('proxies');
    expect(derivedSubtype('client.mp4')).toBe('client');
    expect(derivedSubtype('timeline-sprite.jpg')).toBe('sprites');
    expect(derivedSubtype('reference-uuid.png')).toBe('references');
    expect(derivedSubtype('reference.png')).toBe('references'); // legacy single reference
    expect(derivedSubtype('inconnu.dat')).toBe('other');
  });
});

describe('AdminStorageService — aggregateObjects', () => {
  it('aggregates totals, categories, subtypes and projects sorted by weight', () => {
    const report = aggregateObjects([
      { key: 'projects/alpha/sh/V01/1/a.mov', size: 100 },
      { key: 'projects/alpha/sh/V01/2/b.mov', size: 50 },
      { key: 'projects/beta/sh/V01/3/c.mov', size: 500 },
      { key: 'derived/1/hls/master.m3u8', size: 10 },
      { key: 'derived/1/thumbnail.jpg', size: 5 },
      { key: 'studio/hdris/x.exr', size: 30 },
      { key: 'avatars/1.png', size: 2 },
    ]);
    expect(report.totalObjects).toBe(7);
    expect(report.totalBytes).toBe(697);
    expect(report.categories.originals).toEqual({ count: 3, bytes: 650 });
    expect(report.categories.derived).toEqual({ count: 2, bytes: 15 });
    expect(report.derived.hls).toEqual({ count: 1, bytes: 10 });
    expect(report.studio.hdris).toEqual({ count: 1, bytes: 30 });
    expect(report.projects).toEqual([
      { slug: 'beta', objects: 1, bytes: 500 },
      { slug: 'alpha', objects: 2, bytes: 150 },
    ]);
  });

  it('returns an empty report for no objects', () => {
    const report = aggregateObjects([]);
    expect(report.totalObjects).toBe(0);
    expect(report.projects).toEqual([]);
  });
});

// ── Bucket scan: cost in retained objects and in sweeps ──────────────────────

/**
 * Generator that **reuses a single object** for all yielded items. This is the probe for memory cost:
 * a consumer that aggregates as it goes reads each value before the next and returns the right total;
 * a consumer that stacks the objects in an array ends up with N references to the same slot, so the
 * last object N times. The test therefore fails as long as `storageReport` materializes the bucket
 * (which it used to do).
 */
async function* recycledScan(objects: { key: string; size: number }[]) {
  const buffer = { key: '', size: 0 };
  for (const o of objects) {
    buffer.key = o.key;
    buffer.size = o.size;
    yield buffer;
  }
}

const BUCKET = [
  { key: 'projects/alpha/sh/V01/1/a.mov', size: 100 },
  { key: 'projects/beta/sh/V01/2/b.mov', size: 500 },
  { key: 'derived/1/hls/master.m3u8', size: 10 },
  { key: 'avatars/1.png', size: 2 },
];

afterEach(() => {
  vi.useRealTimers();
  resetStorageReportCache();
  mocks.iterateObjects.mockReset();
  mocks.findMany.mockReset();
});

describe('AdminStorageService — aggregateObjectsStream', () => {
  it('retains no object: the stream is aggregated as it goes', async () => {
    const streamed = await aggregateObjectsStream(recycledScan(BUCKET));
    // Reference: the aggregate of the materialized list, unchanged since always.
    expect(streamed).toEqual(aggregateObjects(BUCKET));
    expect(streamed.totalBytes).toBe(612);
  });
});

describe('AdminStorageService — storageReport', () => {
  const project = { id: 7, slug: 'alpha', name: 'Alpha', deletedAt: null };

  it('aggregates without materializing the bucket and cross-references known projects', async () => {
    mocks.iterateObjects.mockImplementation(() => recycledScan(BUCKET));
    mocks.findMany.mockResolvedValue([project]);
    const report = await storageReport();
    expect(report.totalObjects).toBe(4);
    expect(report.totalBytes).toBe(612);
    expect(report.projects).toEqual([
      { slug: 'beta', objects: 1, bytes: 500, projectId: null, name: null, deleted: false },
      { slug: 'alpha', objects: 1, bytes: 100, projectId: 7, name: 'Alpha', deleted: false },
    ]);
  });

  it('three concurrent openings of the screen = a single sweep', async () => {
    mocks.iterateObjects.mockImplementation(() => recycledScan(BUCKET));
    mocks.findMany.mockResolvedValue([project]);
    const [a, b, c] = await Promise.all([storageReport(), storageReport(), storageReport()]);
    expect(mocks.iterateObjects).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('a refresh within the minute reads the memoized result, beyond that it re-sweeps', async () => {
    vi.useFakeTimers();
    mocks.iterateObjects.mockImplementation(() => recycledScan(BUCKET));
    mocks.findMany.mockResolvedValue([project]);
    await storageReport();
    await storageReport();
    expect(mocks.iterateObjects).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + STORAGE_REPORT_TTL_MS + 1);
    await storageReport();
    expect(mocks.iterateObjects).toHaveBeenCalledTimes(2);
  });

  it('a failed sweep is not memoized: the next attempt sweeps again', async () => {
    mocks.iterateObjects.mockImplementation(() => {
      throw new Error('MinIO injoignable');
    });
    await expect(storageReport()).rejects.toThrow('MinIO injoignable');
    mocks.iterateObjects.mockImplementation(() => recycledScan(BUCKET));
    mocks.findMany.mockResolvedValue([project]);
    await expect(storageReport()).resolves.toMatchObject({ totalObjects: 4 });
    expect(mocks.iterateObjects).toHaveBeenCalledTimes(2);
  });
});
