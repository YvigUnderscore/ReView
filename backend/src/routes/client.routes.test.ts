// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Partage client : ce que la page publique reçoit pour ouvrir un média.
 *
 * Un modèle 3D livré en .fbx, .obj ou .usd n'est lisible par aucun navigateur — le
 * pipeline en produit un .glb (`metadata.glbKey`), et c'est lui qu'il faut servir. La
 * route ne renvoyait que l'original : un invité voyait donc un viewer vide là où un
 * modèle déjà livré en .glb s'affichait très bien.
 */

const { db, share, media } = vi.hoisted(() => {
  const media: { id: number; storageKey: string; metadata: Record<string, unknown> } = {
    id: 128,
    storageKey: 'review/projects/proj/SH0100/V01/128/SH0100_lookdev.fbx',
    metadata: {},
  };
  const share = {
    id: 3,
    projectId: 42,
    createdById: 9,
    permission: 'VIEW',
    scope: {},
    label: 'Client',
    passwordHash: null,
  };
  return { db: { comment: { findMany: vi.fn() } }, share, media };
});

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../services/StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn((key: string) => Promise.resolve(`https://minio/${key}?sig`)) },
  StorageService: { mediaKey: vi.fn(), thumbnailKey: vi.fn() },
}));
vi.mock('../services/ClientShareService', () => ({
  loadShare: vi.fn(() => Promise.resolve(share)),
  loadShareWithSession: vi.fn(() => Promise.resolve(share)),
  consumeView: vi.fn(),
  studioBranding: vi.fn(() => Promise.resolve({})),
  listShareMedia: vi.fn(() => Promise.resolve({ media: [], total: 0, hasMore: false })),
  findShareMedia: vi.fn(() => Promise.resolve(media)),
}));
vi.mock('../services/CommentService', () => ({ createGuest: vi.fn() }));
vi.mock('../lib/shareAccess', () => ({
  signShareSession: vi.fn(() => 'share-auth'),
  verifyShareSession: vi.fn(() => true),
}));
vi.mock('../lib/watermarkConfig', () => ({
  getWatermarkConfig: vi.fn(() => Promise.resolve({ shares: false, opacity: 0.2 })),
}));
vi.mock('../services/AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('../lib/mediaAccess', () => ({ logMediaAccess: vi.fn() }));
vi.mock('../services/JobService', () => ({ enqueueMediaJob: vi.fn(), enqueueSpatialThumb: vi.fn() }));
vi.mock('../services/SocketService', () => ({ emitToProject: vi.fn() }));

import express from 'express';
import request from 'supertest';
import clientRoutes from './client.routes';
import { errorHandler } from '../middleware/error';
import { notFound } from '../lib/errors';

const app = express().use('/api/client', clientRoutes).use(errorHandler);

const token = 'a'.repeat(24);

beforeEach(() => {
  vi.clearAllMocks();
  media.metadata = {};
});

describe('GET /api/client/:token/media/:id/url', () => {
  it('sert le dérivé GLB d’un modèle converti, présigné comme le reste', async () => {
    media.metadata = { glbKey: 'derived/128/model.glb' };
    const res = await request(app).get(`/api/client/${token}/media/128/url`).expect(200);
    expect(res.body.url).toBe(`https://minio/${media.storageKey}?sig`);
    expect(res.body.glbUrl).toBe('https://minio/derived/128/model.glb?sig');
  });

  it('renvoie glbUrl à null quand le média n’a pas de dérivé', async () => {
    const res = await request(app).get(`/api/client/${token}/media/128/url`).expect(200);
    expect(res.body.glbUrl).toBeNull();
    expect(res.body.slateSec).toBe(0);
  });

  it('laisse la vidéo servir son dérivé client, slate comprise', async () => {
    media.metadata = { clientProxyKey: 'derived/128/client.mp4', slateSec: 3 };
    const res = await request(app).get(`/api/client/${token}/media/128/url`).expect(200);
    expect(res.body.url).toBe('https://minio/derived/128/client.mp4?sig');
    expect(res.body.slateSec).toBe(3);
    expect(res.body.glbUrl).toBeNull();
  });

  /** Le dérivé suit la portée du lien : c'est `findShareMedia` qui tranche, pas l'appelant. */
  it('ne signe rien quand le média est hors de la portée du lien', async () => {
    const { findShareMedia } = await import('../services/ClientShareService');
    vi.mocked(findShareMedia).mockRejectedValueOnce(notFound('Media not found'));
    await request(app).get(`/api/client/${token}/media/128/url`).expect(404);
    const { storage } = await import('../services/StorageService');
    expect(storage.getPresignedGetUrl).not.toHaveBeenCalled();
  });
});
