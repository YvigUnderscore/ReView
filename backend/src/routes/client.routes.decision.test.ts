// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Surface publique de partage — l'AVIS du client (« c'est bon » / « à revoir »).
 *
 * Fichier à part, comme `client.routes.guest.test.ts` : le budget de lignes du dossier
 * `routes` compte aussi les tests, et un fichier fourre-tout finit par décourager d'en
 * écrire. Le service est mocké — ce qui se vérifie ici est ce que la ROUTE laisse passer ;
 * la restriction du statut aux deux réponses offertes appartient à `decideAsGuest` et se
 * teste dans `ReviewDecisionService.test.ts`.
 */

const { db, share } = vi.hoisted(() => ({
  db: { project: { findFirst: vi.fn() } },
  share: {
    id: 3,
    projectId: 42,
    createdById: 9,
    permission: 'DECIDE',
    scope: {},
    label: 'Client',
    passwordHash: null as string | null,
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../services/StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn() },
  StorageService: { mediaKey: vi.fn(), thumbnailKey: vi.fn() },
}));
vi.mock('../services/ClientShareService', () => ({
  loadShare: vi.fn(() => Promise.resolve(share)),
  loadShareWithSession: vi.fn(() => Promise.resolve(share)),
  consumeView: vi.fn(),
  studioBranding: vi.fn(() => Promise.resolve({})),
  listShareMedia: vi.fn(() =>
    Promise.resolve({
      media: [],
      browse: { episodes: [], sequences: [], shots: [], assets: [], looseMediaIds: [] },
      total: 0,
      hasMore: false,
    }),
  ),
  listSharePlaylists: vi.fn(() => Promise.resolve([])),
  listShareComments: vi.fn(() => Promise.resolve([])),
  findShareMedia: vi.fn(() => Promise.resolve({ id: 128 })),
  createShareComment: vi.fn(() => Promise.resolve({ id: 1 })),
  createShareDecision: vi.fn(() => Promise.resolve({ id: 5 })),
  shareDecisionStatuses: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('../services/ClientMediaSourceService', () => ({ buildClientMediaSource: vi.fn() }));
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

const app = express().use(express.json()).use('/api/client', clientRoutes).use(errorHandler);
const token = 'a'.repeat(24);

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * L'avis du client : la route ne décide de rien elle-même, elle garde la porte. Ce qui se
 * vérifie ici est ce qu'elle laisse passer — un identifiant de statut plausible, un nom, et
 * rien d'autre ; la restriction du statut aux deux réponses offertes appartient au service.
 */
describe('POST /:token/media/:id/decision — l’avis de l’invité', () => {
  const post = (body: Record<string, unknown>) =>
    request(app).post(`/api/client/${token}/media/128/decision`).send(body);

  it('transmet le nom et le statut au service', async () => {
    await post({ guestName: 'Claire', statusId: 2 }).expect(201);
    const { createShareDecision } = await import('../services/ClientShareService');
    expect(vi.mocked(createShareDecision).mock.calls[0]?.[2]).toMatchObject({
      guestName: 'Claire',
      statusId: 2,
    });
  });

  it('refuse un corps qui n’a ni nom ni statut utilisable', async () => {
    await post({ statusId: 2 }).expect(400);
    await post({ guestName: 'Claire' }).expect(400);
    await post({ guestName: 'Claire', statusId: -1 }).expect(400);
    await post({ guestName: '   ', statusId: 2 }).expect(400);
    const { createShareDecision } = await import('../services/ClientShareService');
    expect(createShareDecision).not.toHaveBeenCalled();
  });

  /**
   * Les deux réponses ne descendent au front que si le lien a le droit de s'en servir :
   * afficher les boutons d'un lien qui sera refusé en écriture est une promesse en l'air.
   */
  it('ne sert les réponses offertes que lorsque le service en rend', async () => {
    db.project.findFirst.mockResolvedValue({
      id: 42,
      name: 'Durian',
      description: null,
      status: 'ACTIVE',
      episodesEnabled: false,
    });
    const { shareDecisionStatuses } = await import('../services/ClientShareService');

    let res = await request(app).get(`/api/client/${token}`).expect(200);
    expect(res.body.decisionStatuses).toBeNull();

    vi.mocked(shareDecisionStatuses).mockResolvedValueOnce({
      approval: { id: 2, name: 'Approved', color: '#2ECC71' },
      retake: null,
    });
    res = await request(app).get(`/api/client/${token}`).expect(200);
    expect(res.body.decisionStatuses.approval).toMatchObject({ id: 2 });
  });
});
