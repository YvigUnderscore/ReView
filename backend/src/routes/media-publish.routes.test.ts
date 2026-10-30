// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { publish } = vi.hoisted(() => ({ publish: vi.fn() }));

vi.mock('../middleware/auth', async () => ({
  ...(await import('../middleware/authUser')),
  authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: 7, role: 'ARTIST', email: 'a@b.c' };
    next();
  },
}));
vi.mock('../services/MediaService', () => ({
  publish,
  finalize: vi.fn(),
  listPublished: vi.fn(),
  listDrafts: vi.fn(),
  getDetail: vi.fn(),
  getUrl: vi.fn(),
  remove: vi.fn(),
}));

import express from 'express';
import request from 'supertest';
import mediaRoutes from './media.routes';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/media', mediaRoutes).use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  publish.mockResolvedValue({ media: { id: 12, published: true }, reviewers: [] });
});

/**
 * Publishing now takes the list of ReViewers and their instructions. The body remains OPTIONAL, and it
 * is the half that gets forgotten: everything that published yesterday (a DCC, an integration, an
 * end-to-end test) posts no body at all. In Express 5, `req.body` is then `undefined`, and a bare
 * `z.object({…})` refuses it with a 400: publication stopped dead, and with it the edit lock it is
 * supposed to set.
 */
describe('POST /api/media/:id/publish — the body is optional', () => {
  it('publishes without any body (no content, no type header)', async () => {
    const res = await request(app).post('/api/media/12/publish');
    expect(res.status).toBe(200);
    // `undefined`, not `[]`: saying nothing does not remove the ReViewers already assigned.
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 12, undefined);
  });

  it('publishes with an empty body (`{}`)', async () => {
    const res = await request(app).post('/api/media/12/publish').send({});
    expect(res.status).toBe(200);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 12, undefined);
  });

  it('passes the list and its instructions on when they are there', async () => {
    const reviewers = [{ userId: 3, note: 'la lumière du 1042' }];
    const res = await request(app).post('/api/media/12/publish').send({ reviewers });
    expect(res.status).toBe(200);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 12, reviewers);
  });

  it('rejects a malformed list without publishing anything', async () => {
    const res = await request(app)
      .post('/api/media/12/publish')
      .send({ reviewers: [{ userId: 'trois' }] });
    expect(res.status).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });
});
