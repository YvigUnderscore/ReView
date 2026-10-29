// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { finalize } = vi.hoisted(() => ({ finalize: vi.fn() }));

vi.mock('../middleware/auth', () => ({
  authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: 7, role: 'ARTIST', email: 'a@b.c' };
    next();
  },
}));
vi.mock('../services/MediaService', () => ({
  finalize,
  publish: vi.fn(),
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
  finalize.mockResolvedValue({ media: { id: 12, published: true }, detectedExtension: '.mov' });
});

/**
 * The mandatory note applied to publication; it now applies to the finalization of the upload (Phase 50).
 * The body of `finalize` was until now NONEXISTENT: everything that finalizes today (the interface, a DCC
 * through the v1 API, an end-to-end test) posts no body at all. In Express 5, `req.body` is then
 * `undefined`, and a bare `z.object({…})` would refuse it with a 400: not a single upload would complete.
 * This is exactly the fault already fixed on `publish`, and this file locks it in.
 */
describe('POST /api/media/:id/finalize — the upload note is optional', () => {
  it('finalizes without any body (no content, no type header)', async () => {
    const res = await request(app).post('/api/media/12/finalize');

    expect(res.status).toBe(200);
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 12, undefined);
  });

  it('finalizes with an empty body (`{}`)', async () => {
    const res = await request(app).post('/api/media/12/finalize').send({});

    expect(res.status).toBe(200);
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 12, undefined);
  });

  it('passes the note on when it is there', async () => {
    const res = await request(app)
      .post('/api/media/12/finalize')
      .send({ note: 'Regarder le raccord au 1042' });

    expect(res.status).toBe(200);
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      12,
      'Regarder le raccord au 1042',
    );
  });

  it('rejects a note that is not text, without calling the service', async () => {
    const res = await request(app).post('/api/media/12/finalize').send({ note: 42 });

    expect(res.status).toBe(400);
    expect(finalize).not.toHaveBeenCalled();
  });

  it('surfaces the service's refusal: business code, not 500', async () => {
    const { AppError } = await import('../lib/errors');
    finalize.mockRejectedValue(
      new AppError('This project requires a note with every upload', 400, 'UPLOAD_NOTE_REQUIRED'),
    );

    const res = await request(app).post('/api/media/12/finalize');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UPLOAD_NOTE_REQUIRED');
  });
});
