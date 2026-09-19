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
  // Borne lue à la construction des schémas Zod du routeur, pas à l'appel.
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
 * La séquence d'images a sa propre finalisation (`completeSequence`), et elle porte donc la
 * même consigne d'upload que `finalize` (Phase 50). Le corps était INEXISTANT jusqu'ici :
 * tout ce qui clôt une séquence poste sans corps, et en Express 5 un `z.object({…})` nu
 * refuserait alors la requête en 400 — mille frames déposées pour rien.
 */
describe('POST /api/media/sequence/:id/complete — la consigne est facultative', () => {
  it('clôt la séquence sans aucun corps', async () => {
    const res = await request(app).post('/api/media/sequence/42/complete');

    expect(res.status).toBe(200);
    expect(completeSequence).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 42, undefined);
  });

  it('transmet la consigne quand elle est là', async () => {
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

  it('refuse une consigne qui n’est pas du texte, sans appeler le service', async () => {
    const res = await request(app).post('/api/media/sequence/42/complete').send({ note: 42 });

    expect(res.status).toBe(400);
    expect(completeSequence).not.toHaveBeenCalled();
  });
});
