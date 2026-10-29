// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { completeSequence } = vi.hoisted(() => ({ completeSequence: vi.fn() }));

vi.mock('../middleware/auth', () => ({
  authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: 7, role: 'ARTIST', email: 'a@b.c' };
    next();
  },
}));
vi.mock('../services/ImageSequenceService', () => ({
  completeSequence,
  initSequence: vi.fn(),
  frameUploadUrls: vi.fn(),
  listSequenceFrames: vi.fn(),
  // Bound read when the router's Zod schemas are built, not at call time.
  FRAME_URL_BATCH_MAX: 64,
}));
vi.mock('../services/MediaUploadService', () => ({
  initMultipart: vi.fn(),
  partUploadUrls: vi.fn(),
  completeMultipart: vi.fn(),
  abortUpload: vi.fn(),
}));
vi.mock('../services/MediaService', () => ({ createUpload: vi.fn() }));

import express from 'express';
import request from 'supertest';
import uploadRoutes from './media-upload.routes';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/media', uploadRoutes).use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  completeSequence.mockResolvedValue({ media: { id: 42, status: 'PROCESSING', size: 16 } });
});

/**
 * The image sequence has its own finalization (`completeSequence`), and therefore carries the same
 * upload note as `finalize` (Phase 50). The body was NONEXISTENT until now: everything that closes a
 * sequence posts no body, and in Express 5 a bare `z.object({…})` would then refuse the request with a
 * 400: a thousand frames uploaded for nothing.
 */
describe('POST /api/media/sequence/:id/complete — the note is optional', () => {
  it('closes the sequence without any body', async () => {
    const res = await request(app).post('/api/media/sequence/42/complete');

    expect(res.status).toBe(200);
    expect(completeSequence).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 42, undefined);
  });

  it('passes the note on when it is there', async () => {
    const res = await request(app)
      .post('/api/media/sequence/42/complete')
      .send({ note: 'Regarder le grain du 1001' });

    expect(res.status).toBe(200);
    expect(completeSequence).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      42,
      'Regarder le grain du 1001',
    );
  });

  it('rejects a note that is not text, without calling the service', async () => {
    const res = await request(app).post('/api/media/sequence/42/complete').send({ note: 42 });

    expect(res.status).toBe(400);
    expect(completeSequence).not.toHaveBeenCalled();
  });
});
