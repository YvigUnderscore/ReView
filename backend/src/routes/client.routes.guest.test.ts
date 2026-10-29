// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * PUBLIC sharing surface: the only write of the application open to an anonymous visitor.
 *
 * Two findings are closed here:
 *  - **A2-02**: `POST /:token/media/:id/comments` had no rate brake, whereas `/unlock`, just above it,
 *    has one. Each call creates a row, broadcasts a socket, and goes out as a webhook and a ShotGrid note.
 *  - **A2-04**: `cameraState` was declared `z.any()` there, that is, JSON of free shape and free volume
 *    written to the database on presentation of a link.
 */

const { db, share } = vi.hoisted(() => ({
  // `findShareMedia` is called INSIDE the service: a mock of the export does not intercept it (ESM).
  // It is therefore the repository that is stubbed, and the scope runs for real.
  db: {
    comment: { findMany: vi.fn() },
    mediaObject: { findFirst: vi.fn(() => Promise.resolve({ id: 128, storageKey: 'review/x.mp4' })) },
  },
  share: {
    id: 3,
    projectId: 42,
    createdById: 9,
    permission: 'COMMENT',
    scope: {},
    label: 'Client',
    passwordHash: null,
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/storage', () => ({
  storage: { getPresignedGetUrl: vi.fn(() => Promise.resolve('https://minio/x?sig')) },
  StorageService: { mediaKey: vi.fn(), thumbnailKey: vi.fn() },
}));
// The service stays REAL; only its repository accesses are stubbed: what is measured here is the
// complete write chain of a guest (link permission, scope, validation of the blobs), not the fidelity
// of a mock. `createGuest` remains the only breakpoint.
vi.mock('../services/ClientShareService', async (importActual) => ({
  ...(await importActual<typeof import('../services/ClientShareService')>()),
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
}));
vi.mock('../services/CommentService', () => ({
  createGuest: vi.fn(() => Promise.resolve({ id: 1, content: 'ok' })),
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
vi.mock('../lib/queues', () => ({ enqueueMediaJob: vi.fn(), enqueueSpatialThumb: vi.fn() }));
vi.mock('../services/SocketService', () => ({ emitToProject: vi.fn() }));

import express from 'express';
import request from 'supertest';
import clientRoutes from './client.routes';
import { errorHandler } from '../middleware/error';
import { createGuest } from '../services/CommentService';

/** Same body ceiling as `app.ts`: it is the schema that is measured, not the parser. */
const json = express.json({ limit: '2mb' });
const app = express().use(json).use('/api/client', clientRoutes).use(errorHandler);
/** Same router, but behind a trusted proxy: `req.ip` follows `X-Forwarded-For` there. */
const behindProxy = express();
behindProxy.set('trust proxy', true);
behindProxy.use(json).use('/api/client', clientRoutes).use(errorHandler);

/** Counters are keyed on the token: one token per case means a fresh budget. */
const tokenOf = (name: string) => name.padEnd(24, 'x');

const post = (token: string, body: Record<string, unknown>) =>
  request(app).post(`/api/client/${token}/media/128/comments`).send(body);

const comment = { guestName: 'Claire', content: 'le raccord saute' };

beforeEach(() => vi.mocked(createGuest).mockClear());

describe('POST /:token/media/:id/comments — camera pose schema (A2-04)', () => {
  it('accepts the pose that the 3D viewer actually sends', async () => {
    const cameraState = { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 }, fov: 45 };
    await post(tokenOf('shape-ok'), { ...comment, cameraState }).expect(201);
    expect(vi.mocked(createGuest).mock.calls[0]?.[2]).toMatchObject({ cameraState });
  });

  it('rejects an arbitrary blob and writes nothing', async () => {
    const cameraState = { pad: 'A'.repeat(200_000) };
    await post(tokenOf('shape-ko'), { ...comment, cameraState }).expect(400);
    expect(createGuest).not.toHaveBeenCalled();
  });

  it('tolerates the absence of a pose, as the share page does', async () => {
    await post(tokenOf('shape-nul'), { ...comment, cameraState: null }).expect(201);
  });
});

describe('POST /:token/media/:id/comments — rate brake (A2-02)', () => {
  it('bounds a guest to thirty comments per quarter hour, then refuses with 429', async () => {
    const token = tokenOf('freinip');
    for (let i = 0; i < 30; i += 1) {
      expect((await post(token, comment)).status).toBe(201);
    }
    const blocked = await post(token, comment);
    expect(blocked.status).toBe(429);
    expect(vi.mocked(createGuest)).toHaveBeenCalledTimes(30);
  });

  /**
   * The point that justifies the double key: under `TRUST_PROXY`, the IP is whatever the caller
   * declares. Renewing it reopens as many per-IP counters as one likes, and reopens nothing of the
   * per-link counter, which is the only ceiling that is truly unforgeable here.
   */
  it('cannot be reopened by changing the declared address', async () => {
    const token = tokenOf('freinlien');
    const send = (ip: string) =>
      request(behindProxy)
        .post(`/api/client/${token}/media/128/comments`)
        .set('X-Forwarded-For', ip)
        .send(comment);
    for (let i = 0; i < 120; i += 1) {
      expect((await send(`10.0.0.${i}`)).status).toBe(201);
    }
    // 121st call, address never seen before: its per-IP counter is fresh, but the link's budget
    // no longer is.
    expect((await send('10.9.9.9')).status).toBe(429);
  });
});
