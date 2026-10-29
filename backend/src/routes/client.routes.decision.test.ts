// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Public sharing surface: the CLIENT's opinion ("good to go" / "to revise").
 *
 * Separate file, like `client.routes.guest.test.ts`: the line budget of the `routes` folder also counts
 * the tests, and a catch-all file ends up discouraging writing them. The service is mocked: what is
 * verified here is what the ROUTE lets through; restricting the status to the two offered answers
 * belongs to `decideAsGuest` and is tested in `ReviewDecisionService.test.ts`.
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
 * The client's opinion: the route decides nothing itself, it guards the door. What is verified here is
 * what it lets through: a plausible status identifier, a name, and nothing else; restricting the status
 * to the two offered answers belongs to the service.
 */
describe('POST /:token/media/:id/decision — the guest's opinion', () => {
  const post = (body: Record<string, unknown>) =>
    request(app).post(`/api/client/${token}/media/128/decision`).send(body);

  it('passes the name and the status on to the service', async () => {
    await post({ guestName: 'Claire', statusId: 2 }).expect(201);
    const { createShareDecision } = await import('../services/ClientShareService');
    expect(vi.mocked(createShareDecision).mock.calls[0]?.[2]).toMatchObject({
      guestName: 'Claire',
      statusId: 2,
    });
  });

  it('rejects a body with neither a usable name nor a usable status', async () => {
    await post({ statusId: 2 }).expect(400);
    await post({ guestName: 'Claire' }).expect(400);
    await post({ guestName: 'Claire', statusId: -1 }).expect(400);
    await post({ guestName: '   ', statusId: 2 }).expect(400);
    const { createShareDecision } = await import('../services/ClientShareService');
    expect(createShareDecision).not.toHaveBeenCalled();
  });

  /**
   * The two answers only reach the front end if the link is allowed to use them: displaying the
   * buttons of a link that will be refused write access is an empty promise.
   */
  it('only serves the offered answers when the service returns them', async () => {
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
