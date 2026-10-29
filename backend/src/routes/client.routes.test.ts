// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Client sharing: what the PUBLIC route does with what the services return to it.
 *
 * The services are mocked here, and deliberately so. The scope of a link is tested on pure filters
 * (`ClientShareService.test.ts`, `shareBrowse.test.ts`) and the payload of a media on its constructor
 * (`ClientMediaSourceService.test.ts`); a scope test written here would only prove the fidelity of the
 * mock. What is verified at this level is what the route lets out: nothing before unlocking, and the
 * tree as is.
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
  it("returns the constructor's payload, without rewriting it", async () => {
    const res = await request(app).get(`/api/client/${token}/media/128/url`).expect(200);
    expect(res.body).toEqual({ url: 'https://minio/plate?sig' });
  });

  /** The derivative follows the scope of the link: it is `findShareMedia` that decides, not the caller. */
  it('builds nothing when the media is outside the scope of the link', async () => {
    const { findShareMedia } = await import('../services/ClientShareService');
    vi.mocked(findShareMedia).mockRejectedValueOnce(notFound('Media not found'));
    await request(app).get(`/api/client/${token}/media/128/url`).expect(404);
    const { buildClientMediaSource } = await import('../services/ClientMediaSourceService');
    expect(buildClientMediaSource).not.toHaveBeenCalled();
  });
});

describe('GET /api/client/:token — what the home page lets out', () => {
  beforeEach(() => {
    db.project.findFirst.mockResolvedValue({
      id: 42,
      name: 'Durian',
      description: null,
      status: 'ACTIVE',
      episodesEnabled: false,
    });
  });

  it("returns the service's tree and playlists, without rewriting them", async () => {
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

  // Playlist cards carry only identifiers: they can only be bounded to the served page if the service
  // knows that page.
  it('only claims playlists together with the media actually served', async () => {
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
   * A password-protected link, without a session: the studio decoration and nothing else. Neither the
   * name of the project, nor a media, nor, above all, a shot or playlist name. The tree makes this test
   * indispensable: before it, the worst that could leak was a file name.
   */
  it('discloses neither project nor tree before unlocking', async () => {
    share.passwordHash = 'hash';
    const { verifyShareSession } = await import('../lib/shareAccess');
    vi.mocked(verifyShareSession).mockReturnValueOnce(false);

    const res = await request(app).get(`/api/client/${token}`).expect(200);
    expect(res.body).toEqual({ locked: true, studio: {} });
    const { listShareMedia } = await import('../services/ClientShareService');
    expect(listShareMedia).not.toHaveBeenCalled();
  });
});

describe("POST /api/client/:token/media/:id/comments — the guest's drawing", () => {
  const post = (body: Record<string, unknown>) =>
    request(app).post(`/api/client/${token}/media/128/comments`).send(body);
  const base = { guestName: 'Client', content: 'Trop sombre' };
  const rect = { type: 'rect', id: 'a', color: '#ef4444', width: 3, x: 0.1, y: 0.1, w: 0.2, h: 0.2 };

  /**
   * The regression this batch closes: without the key in the schema, `validate` replacing `req.body`
   * with the parsed one, the annotation left, received a 201, and was never written.
   */
  it('passes the annotation on to the service instead of silently dropping it', async () => {
    await post({ ...base, annotation: [rect] }).expect(201);
    const { createShareComment } = await import('../services/ClientShareService');
    expect(vi.mocked(createShareComment).mock.calls[0]?.[2].annotation).toEqual([rect]);
  });

  // Staging in 3D, painter strokes: gestures replayed for ALL the viewers of the media. A share link
  // has no business writing them.
  it('refuses the author shares that a guest has no business setting', async () => {
    await post({ ...base, annotation: [{ type: 'scene-override', override: null }] }).expect(400);
    await post({
      ...base,
      annotation: [{ type: 'splat-paint', points: [0, 0, 0], color: '#ffffff', width: 1 }],
    }).expect(400);
    const { createShareComment } = await import('../services/ClientShareService');
    expect(createShareComment).not.toHaveBeenCalled();
  });

  it('accepts feedback without an annotation, as before', async () => {
    await post(base).expect(201);
    const { createShareComment } = await import('../services/ClientShareService');
    expect(vi.mocked(createShareComment).mock.calls[0]?.[2].annotation).toBeUndefined();
  });
});
