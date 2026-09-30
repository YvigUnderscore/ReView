// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Ce qu'un invité reçoit pour ouvrir un média.
 *
 * La page publique déclarait quatorze champs et la route n'en servait que trois : le viewer
 * invité retombait sur des valeurs par défaut aveugles. Deux d'entre elles se voient dès
 * qu'on laisse le client annoter — `fps` et `startFrame` ancrent l'annotation à une frame,
 * et une frame fausse est un numéro que l'artiste ne retrouve pas.
 */

const { db, hdri } = vi.hoisted(() => ({
  db: { project: { findUnique: vi.fn() } },
  hdri: { findWithUrl: vi.fn() },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn((key: string) => Promise.resolve(`https://minio/${key}?sig`)) },
}));
vi.mock('./MediaService', () => ({
  mediaViewKey: vi.fn((media: { storageKey: string }) => media.storageKey),
}));
vi.mock('./HdriService', () => hdri);
vi.mock('../lib/projectSettings', () => ({
  resolveProjectSettingsById: vi.fn(() => Promise.resolve({ defaultLighting: { exposure: 1 } })),
}));
// La chaîne d'héritage du ratio a son propre banc (`lib/deliveryAspect`) ; ici on vérifie
// seulement que l'invité le reçoit — sans lui, son cadre retombe sur un 16/9 arbitraire.
vi.mock('../lib/deliveryAspect', () => ({ resolveDeliveryAspect: vi.fn(() => Promise.resolve(2.39)) }));

import type { MediaObject } from '@prisma/client';
import { buildClientMediaSource } from './ClientMediaSourceService';
import { resolveDeliveryAspect } from '../lib/deliveryAspect';

const VERSION = 77;

const mediaOf = (metadata: Record<string, unknown>): MediaObject =>
  ({
    id: 128,
    versionId: VERSION,
    storageKey: 'review/projects/p/SH0100/V01/128/plate.fbx',
    metadata,
  }) as unknown as MediaObject;

beforeEach(() => {
  vi.clearAllMocks();
  db.project.findUnique.mockResolvedValue({ startFrame: 1001 });
  hdri.findWithUrl.mockResolvedValue(null);
});

describe('buildClientMediaSource — de quoi ouvrir un média chez l’invité', () => {
  it('sert le dérivé GLB d’un modèle converti, présigné comme le reste', async () => {
    const source = await buildClientMediaSource(mediaOf({ glbKey: 'derived/128/model.glb' }), 42);
    expect(source.url).toBe('https://minio/review/projects/p/SH0100/V01/128/plate.fbx?sig');
    expect(source.glbUrl).toBe('https://minio/derived/128/model.glb?sig');
  });

  it('renvoie glbUrl à null quand le média n’a pas de dérivé', async () => {
    const source = await buildClientMediaSource(mediaOf({}), 42);
    expect(source.glbUrl).toBeNull();
    expect(source.slateSec).toBe(0);
  });

  it('laisse la vidéo servir son dérivé client, slate comprise', async () => {
    const source = await buildClientMediaSource(
      mediaOf({ clientProxyKey: 'derived/128/client.mp4', slateSec: 3 }),
      42,
    );
    expect(source.url).toBe('https://minio/derived/128/client.mp4?sig');
    expect(source.slateSec).toBe(3);
    expect(source.glbUrl).toBeNull();
  });

  // Le slate n'appartient qu'au dérivé : l'annoncer sans lui décalerait tous les timestamps.
  it('ignore un slate déclaré sans dérivé client', async () => {
    expect((await buildClientMediaSource(mediaOf({ slateSec: 3 }), 42)).slateSec).toBe(0);
  });

  /**
   * Le cœur du lot : une annotation vidéo est ancrée à une frame. Sans la cadence réelle, le
   * viewer invité retombe sur 24 fps et dérive d'une frame par seconde sur un 23.976.
   */
  it('porte la cadence et la première frame du projet', async () => {
    db.project.findUnique.mockResolvedValue({ startFrame: 1 });
    const source = await buildClientMediaSource(mediaOf({ fps: 23.976 }), 42);
    expect(source.fps).toBe(23.976);
    expect(source.startFrame).toBe(1);
  });

  it('retombe sur la première frame de convention quand le projet n’en déclare pas', async () => {
    db.project.findUnique.mockResolvedValue(null);
    const source = await buildClientMediaSource(mediaOf({}), 42);
    expect(source.startFrame).toBe(1001);
    expect(source.fps).toBeNull();
  });

  it('rejoue la mise en scène du splat : éditions, masque, ops et présentation', async () => {
    const source = await buildClientMediaSource(
      mediaOf({
        splatEdits: { flip: true },
        splatMaskKey: 'derived/128/mask.bin',
        splatSubsetKey: 'derived/128/ops.bin',
        splatPresentation: { camera: { aspect: 2.39 } },
      }),
      42,
    );
    expect(source.splatEdits).toEqual({ flip: true });
    expect(source.splatMaskUrl).toBe('https://minio/derived/128/mask.bin?sig');
    expect(source.splatSubsetUrl).toBe('https://minio/derived/128/ops.bin?sig');
    expect(source.splatPresentation).toEqual({ camera: { aspect: 2.39 } });
  });

  /**
   * Le ratio du cadre de livraison, hérité des réglages pipeline du plan de la version. Sans
   * lui, un spatial sans mise en scène s'ouvre chez l'invité dans un 16/9 arbitraire, alors
   * que le projet livre peut-être en scope — et l'invité annote un cadre qui n'est pas le bon.
   */
  it('porte le ratio de livraison hérité, résolu pour le plan de SA version', async () => {
    const source = await buildClientMediaSource(mediaOf({}), 42);
    expect(source.deliveryAspect).toBeCloseTo(2.39);
    expect(vi.mocked(resolveDeliveryAspect)).toHaveBeenCalledWith(VERSION, 42);
  });

  // Sans les chemins de prims, l'override USD n'indexe rien et la scène s'ouvre telle que
  // le GLB a été cuit — un repli correct, pas la mise en scène du superviseur.
  it('remonte les chemins de prims et les variantes qui indexent l’override USD', async () => {
    const source = await buildClientMediaSource(
      mediaOf({
        usdOverride: { hidden: ['/root/sphere'] },
        model: {
          usd: { prims: [{ path: '/root' }, { path: '/root/sphere' }], variantSets: [{ prim: '/root' }] },
        },
      }),
      42,
    );
    expect(source.usdPrimPaths).toEqual(['/root', '/root/sphere']);
    expect(source.usdVariantSets).toEqual([{ prim: '/root' }]);
    expect(source.usdOverride).toEqual({ hidden: ['/root/sphere'] });
  });

  it('laisse les champs USD nuls quand le média n’est pas une scène USD', async () => {
    const source = await buildClientMediaSource(mediaOf({}), 42);
    expect(source.usdPrimPaths).toBeNull();
    expect(source.usdVariantSets).toBeNull();
  });

  /**
   * Le viewer connecté interroge `/api/studio/hdris`, une route authentifiée : sans
   * résolution ici, un média mis en scène sous une HDRI s'ouvre en éclairage neutre.
   */
  it('résout l’HDRI de la présentation en URL, et rien d’autre', async () => {
    hdri.findWithUrl.mockResolvedValue({ url: 'https://minio/studio/hdris/x.hdr?sig', format: 'hdr' });
    const source = await buildClientMediaSource(
      mediaOf({ splatPresentation: { lighting: { hdriId: 'abc' } } }),
      42,
    );
    expect(hdri.findWithUrl).toHaveBeenCalledWith('abc');
    expect(source.hdri).toEqual({ url: 'https://minio/studio/hdris/x.hdr?sig', format: 'hdr' });
  });

  it('n’interroge pas la bibliothèque HDRI quand la présentation n’en cite aucune', async () => {
    const source = await buildClientMediaSource(mediaOf({}), 42);
    expect(hdri.findWithUrl).not.toHaveBeenCalled();
    expect(source.hdri).toBeNull();
  });

  // Une HDRI retirée de la bibliothèque ne doit pas casser l'ouverture du média.
  it('tolère une HDRI disparue de la bibliothèque', async () => {
    const source = await buildClientMediaSource(
      mediaOf({ splatPresentation: { lighting: { hdriId: 'gone' } } }),
      42,
    );
    expect(source.hdri).toBeNull();
  });

  it('porte l’éclairage par défaut du projet, repli des médias sans le leur', async () => {
    const source = await buildClientMediaSource(mediaOf({}), 42);
    expect(source.projectDefaultLighting).toEqual({ exposure: 1 });
  });
});
