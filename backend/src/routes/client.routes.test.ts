// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Partage client : ce que la ROUTE publique fait de ce que les services lui rendent.
 *
 * Les services sont mockés ici, et c'est délibéré. La portée d'un lien se teste sur des
 * filtres purs (`ClientShareService.test.ts`, `shareBrowse.test.ts`) et la charge utile d'un
 * média sur son constructeur (`ClientMediaSourceService.test.ts`) ; un test de portée écrit
 * ici ne prouverait que la fidélité du mock. Ce qui se vérifie à ce niveau, c'est ce que la
 * route laisse sortir : rien avant déverrouillage, et l'arborescence telle quelle.
 */

const { db, share, media, emptyBrowse } = vi.hoisted(() => {
  const media: { id: number; storageKey: string; metadata: Record<string, unknown> } = {
    id: 128,
    storageKey: 'review/projects/proj/SH0100/V01/128/SH0100_lookdev.fbx',
    metadata: {},
  };
  const share = {
    id: 3,
    projectId: 42,
    createdById: 9,
    permission: 'COMMENT',
    scope: {},
    label: 'Client',
    passwordHash: null as string | null,
  };
  const emptyBrowse = { episodes: [], sequences: [], shots: [], assets: [], looseMediaIds: [] };
  return { db: { project: { findFirst: vi.fn() } }, share, media, emptyBrowse };
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
  listShareMedia: vi.fn(() => Promise.resolve({ media: [], browse: emptyBrowse, total: 0, hasMore: false })),
  listSharePlaylists: vi.fn(() => Promise.resolve([])),
  listShareComments: vi.fn(() => Promise.resolve([])),
  findShareMedia: vi.fn(() => Promise.resolve(media)),
  createShareComment: vi.fn(() => Promise.resolve({ id: 1 })),
  createShareDecision: vi.fn(() => Promise.resolve({ id: 5 })),
  shareDecisionStatuses: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('../services/ClientMediaSourceService', () => ({
  buildClientMediaSource: vi.fn(() => Promise.resolve({ url: 'https://minio/plate?sig' })),
}));
vi.mock('../lib/shareAccess', () => ({
  signShareSession: vi.fn(() => 'share-auth'),
  verifyShareSession: vi.fn(() => true),
}));
vi.mock('../lib/watermarkConfig', () => ({
  getWatermarkConfig: vi.fn(() => Promise.resolve({ shares: false, opacity: 0.2 })),
}));
vi.mock('../services/AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('../lib/mediaAccess', () => ({ logMediaAccess: vi.fn() }));
vi.mock('./clientShareLimits', () => ({ guestCommentRateLimit: [] }));

import express from 'express';
import request from 'supertest';
import clientRoutes from './client.routes';
import { errorHandler } from '../middleware/error';
import { notFound } from '../lib/errors';

const app = express().use(express.json()).use('/api/client', clientRoutes).use(errorHandler);

const token = 'a'.repeat(24);

beforeEach(() => {
  vi.clearAllMocks();
  media.metadata = {};
  share.passwordHash = null;
  share.permission = 'COMMENT';
});

describe('GET /api/client/:token/media/:id/url', () => {
  it('rend la charge utile du constructeur, sans la réécrire', async () => {
    const res = await request(app).get(`/api/client/${token}/media/128/url`).expect(200);
    expect(res.body).toEqual({ url: 'https://minio/plate?sig' });
  });

  /** Le dérivé suit la portée du lien : c'est `findShareMedia` qui tranche, pas l'appelant. */
  it('ne construit rien quand le média est hors de la portée du lien', async () => {
    const { findShareMedia } = await import('../services/ClientShareService');
    vi.mocked(findShareMedia).mockRejectedValueOnce(notFound('Media not found'));
    await request(app).get(`/api/client/${token}/media/128/url`).expect(404);
    const { buildClientMediaSource } = await import('../services/ClientMediaSourceService');
    expect(buildClientMediaSource).not.toHaveBeenCalled();
  });
});

describe('GET /api/client/:token — ce que l’accueil laisse sortir', () => {
  beforeEach(() => {
    db.project.findFirst.mockResolvedValue({
      id: 42,
      name: 'Durian',
      description: null,
      status: 'ACTIVE',
      episodesEnabled: false,
    });
  });

  it('rend l’arborescence et les playlists du service, sans les réécrire', async () => {
    const { listShareMedia, listSharePlaylists } = await import('../services/ClientShareService');
    vi.mocked(listShareMedia).mockResolvedValueOnce({
      media: [{ id: 7 }],
      browse: { ...emptyBrowse, shots: [{ id: 20, code: 'SH020' }] },
      total: 1,
      hasMore: false,
    } as never);
    vi.mocked(listSharePlaylists).mockResolvedValueOnce([{ id: 5, name: 'Dailies' }] as never);

    const res = await request(app).get(`/api/client/${token}`).expect(200);
    expect(res.body.browse.shots).toEqual([{ id: 20, code: 'SH020' }]);
    expect(res.body.browse.playlists).toEqual([{ id: 5, name: 'Dailies' }]);
    expect(res.body.mediaTotal).toBe(1);
    expect(res.body.mediaHasMore).toBe(false);
  });

  // Les cartes de playlist ne portent que des identifiants : elles ne peuvent être bornées à
  // la page servie que si le service connaît cette page.
  it('ne réclame les playlists qu’avec les médias réellement servis', async () => {
    const { listShareMedia, listSharePlaylists } = await import('../services/ClientShareService');
    vi.mocked(listShareMedia).mockResolvedValueOnce({
      media: [{ id: 7 }, { id: 9 }],
      browse: emptyBrowse,
      total: 2,
      hasMore: false,
    } as never);
    await request(app).get(`/api/client/${token}`).expect(200);
    expect(vi.mocked(listSharePlaylists).mock.calls[0]?.[1]).toEqual(new Set([7, 9]));
  });

  /**
   * Un lien à mot de passe, sans session : l'habillage studio et rien d'autre. Ni le nom du
   * projet, ni un média, ni — surtout — un nom de plan ou de playlist. L'arborescence rend ce
   * test indispensable : avant elle, le pire qui pouvait fuir était un nom de fichier.
   */
  it('ne divulgue ni projet ni arborescence avant déverrouillage', async () => {
    share.passwordHash = 'hash';
    const { verifyShareSession } = await import('../lib/shareAccess');
    vi.mocked(verifyShareSession).mockReturnValueOnce(false);

    const res = await request(app).get(`/api/client/${token}`).expect(200);
    expect(res.body).toEqual({ locked: true, studio: {} });
    const { listShareMedia } = await import('../services/ClientShareService');
    expect(listShareMedia).not.toHaveBeenCalled();
  });
});

describe('POST /api/client/:token/media/:id/comments — le dessin de l’invité', () => {
  const post = (body: Record<string, unknown>) =>
    request(app).post(`/api/client/${token}/media/128/comments`).send(body);
  const base = { guestName: 'Client', content: 'Trop sombre' };
  const rect = { type: 'rect', id: 'a', color: '#ef4444', width: 3, x: 0.1, y: 0.1, w: 0.2, h: 0.2 };

  /**
   * La régression que ce lot referme : sans la clé au schéma, `validate` remplaçant
   * `req.body` par le parsé, l'annotation partait, recevait un 201, et n'était jamais écrite.
   */
  it('transmet l’annotation au service au lieu de la jeter en silence', async () => {
    await post({ ...base, annotation: [rect] }).expect(201);
    const { createShareComment } = await import('../services/ClientShareService');
    expect(vi.mocked(createShareComment).mock.calls[0]?.[2].annotation).toEqual([rect]);
  });

  // Mise en scène 3D, traits du painter : des gestes rejoués pour TOUS les spectateurs du
  // média. Un lien de partage n'a pas à en écrire.
  it('refuse les parts d’auteur qu’un invité n’a pas à poser', async () => {
    await post({ ...base, annotation: [{ type: 'scene-override', override: null }] }).expect(400);
    await post({
      ...base,
      annotation: [{ type: 'splat-paint', points: [0, 0, 0], color: '#ffffff', width: 1 }],
    }).expect(400);
    const { createShareComment } = await import('../services/ClientShareService');
    expect(createShareComment).not.toHaveBeenCalled();
  });

  it('accepte un retour sans annotation, comme avant', async () => {
    await post(base).expect(201);
    const { createShareComment } = await import('../services/ClientShareService');
    expect(vi.mocked(createShareComment).mock.calls[0]?.[2].annotation).toBeUndefined();
  });
});
