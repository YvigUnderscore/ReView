// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

// Fonctions pures testées : on neutralise les dépendances env/DB des imports.
vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('./StorageService', () => ({ storage: {} }));

import { classifyKey, derivedSubtype, aggregateObjects } from './AdminStorageService';

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
