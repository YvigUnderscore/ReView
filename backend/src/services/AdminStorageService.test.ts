// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, it, expect, vi } from 'vitest';

// Fonctions pures testées : on neutralise les dépendances env/DB des imports. Le scan du
// bucket et la table Project sont doublés — ce qui nous intéresse ici, ce sont les
// opérations (combien de balayages, combien d'objets retenus), pas des octets réels.
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
  it('classe les originaux avec leur slug de projet', () => {
    expect(classifyKey('projects/demo-film/SQ010-SH020/V01/42/plate.mov')).toEqual({
      category: 'originals',
      projectSlug: 'demo-film',
    });
  });

  it('classe les dérivés avec leur sous-type', () => {
    expect(classifyKey('derived/42/hls/master.m3u8')).toEqual({ category: 'derived', sub: 'hls' });
    expect(classifyKey('derived/42/thumbnail.webp')).toEqual({ category: 'derived', sub: 'thumbnails' });
    expect(classifyKey('derived/42/model.glb')).toEqual({ category: 'derived', sub: 'glb' });
    expect(classifyKey('derived/42/splat-mask.bin')).toEqual({ category: 'derived', sub: 'splat-edits' });
  });

  it('classe les bibliothèques studio, avatars et quarantaine', () => {
    expect(classifyKey('studio/hdris/abc.exr')).toEqual({ category: 'studio', sub: 'hdris' });
    expect(classifyKey('studio/ocio/abc.ocio')).toEqual({ category: 'studio', sub: 'ocio' });
    expect(classifyKey('avatars/7.png')).toEqual({ category: 'avatars' });
    expect(classifyKey('quarantine/42/virus.mov')).toEqual({ category: 'quarantine' });
    expect(classifyKey('comments/attachments/3/note.webm')).toEqual({ category: 'comments' });
  });

  it('range l’inconnu dans other', () => {
    expect(classifyKey('tmp/whatever.bin').category).toBe('other');
  });
});

describe('AdminStorageService — derivedSubtype', () => {
  it('reconnaît chaque dérivé du worker FFmpeg', () => {
    expect(derivedSubtype('proxy.mp4')).toBe('proxies');
    expect(derivedSubtype('proxy-trim.mp4')).toBe('proxies');
    expect(derivedSubtype('client.mp4')).toBe('client');
    expect(derivedSubtype('timeline-sprite.jpg')).toBe('sprites');
    expect(derivedSubtype('reference-uuid.png')).toBe('references');
    expect(derivedSubtype('reference.png')).toBe('references'); // référence unique legacy
    expect(derivedSubtype('inconnu.dat')).toBe('other');
  });
});

describe('AdminStorageService — aggregateObjects', () => {
  it('agrège totaux, catégories, sous-types et projets triés par poids', () => {
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

  it('rend un rapport vide sans objet', () => {
    const report = aggregateObjects([]);
    expect(report.totalObjects).toBe(0);
    expect(report.projects).toEqual([]);
  });
});

// ── Scan du bucket : coût en objets retenus et en balayages ───────────────────

/**
 * Générateur qui **réutilise un seul objet** pour tous les éléments rendus. C'est la sonde
 * du coût mémoire : un consommateur qui agrège au fil de l'eau lit chaque valeur avant la
 * suivante et rend le bon total ; un consommateur qui empile les objets dans un tableau se
 * retrouve avec N références vers la même case, donc N fois le dernier objet. Le test
 * échoue donc tant que `storageReport` matérialise le bucket (ce qu'il faisait).
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
  it('ne retient aucun objet : le flux est agrégé au fil de l’eau', async () => {
    const streamed = await aggregateObjectsStream(recycledScan(BUCKET));
    // Référence : l'agrégat de la liste matérialisée, inchangé depuis toujours.
    expect(streamed).toEqual(aggregateObjects(BUCKET));
    expect(streamed.totalBytes).toBe(612);
  });
});

describe('AdminStorageService — storageReport', () => {
  const project = { id: 7, slug: 'alpha', name: 'Alpha', deletedAt: null };

  it('agrège sans matérialiser le bucket et croise les projets connus', async () => {
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

  it('trois ouvertures concurrentes de l’écran = un seul balayage', async () => {
    mocks.iterateObjects.mockImplementation(() => recycledScan(BUCKET));
    mocks.findMany.mockResolvedValue([project]);
    const [a, b, c] = await Promise.all([storageReport(), storageReport(), storageReport()]);
    expect(mocks.iterateObjects).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('un F5 dans la minute relit la mémoïsation, au-delà relance le balayage', async () => {
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

  it('un balayage en échec n’est pas mémoïsé : la tentative suivante rebalaye', async () => {
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
