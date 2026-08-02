// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: { setting: { findUnique: vi.fn(), upsert: vi.fn() } },
}));
vi.mock('./StorageService', () => ({
  storage: {
    getPresignedGetUrl: vi.fn(async (k: string) => `https://minio/${k}?sig`),
    getPresignedPutUrl: vi.fn(async (k: string) => `https://minio/${k}?put`),
    deleteObject: vi.fn(async () => undefined),
  },
}));

import { listWithUrls, presignUpload, add, remove } from './HdriService';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';

const findUnique = vi.mocked(prisma.setting.findUnique);
const upsert = vi.mocked(prisma.setting.upsert);

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockResolvedValue({} as never);
});

describe('HdriService', () => {
  it('liste vide quand aucun réglage', async () => {
    findUnique.mockResolvedValue(null as never);
    expect(await listWithUrls()).toEqual([]);
  });

  it('présigne un upload avec une clé sous studio/hdris et le bon type', async () => {
    const { storageKey, uploadUrl } = await presignUpload('exr');
    expect(storageKey).toMatch(/^studio\/hdris\/.*\.exr$/);
    expect(uploadUrl).toContain('put');
    expect(storage.getPresignedPutUrl).toHaveBeenCalledWith(storageKey, 'image/x-exr');
  });

  it('refuse un format invalide', async () => {
    // @ts-expect-error test d'un format hors énumération
    await expect(presignUpload('png')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('ajoute une entrée en fusionnant la bibliothèque existante', async () => {
    findUnique.mockResolvedValue({ value: '[]' } as never);
    const entry = await add('Studio neutre', 'studio/hdris/x.hdr', 'hdr');
    expect(entry).toMatchObject({ name: 'Studio neutre', format: 'hdr' });
    const written = JSON.parse((upsert.mock.calls[0]![0] as { create: { value: string } }).create.value);
    expect(written).toHaveLength(1);
    expect(written[0].storageKey).toBe('studio/hdris/x.hdr');
  });

  it('refuse une clé de stockage hors studio/hdris', async () => {
    findUnique.mockResolvedValue({ value: '[]' } as never);
    await expect(add('x', 'autre/cle.hdr', 'hdr')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('supprime une entrée et son objet MinIO', async () => {
    const existing = [{ id: 'a', name: 'A', storageKey: 'studio/hdris/a.hdr', format: 'hdr', createdAt: '' }];
    findUnique.mockResolvedValue({ value: JSON.stringify(existing) } as never);
    await remove('a');
    expect(storage.deleteObject).toHaveBeenCalledWith('studio/hdris/a.hdr');
    const written = JSON.parse((upsert.mock.calls[0]![0] as { create: { value: string } }).create.value);
    expect(written).toHaveLength(0);
  });

  it('lève notFound pour un id inconnu', async () => {
    findUnique.mockResolvedValue({ value: '[]' } as never);
    await expect(remove('zzz')).rejects.toMatchObject({ statusCode: 404 });
  });
});
