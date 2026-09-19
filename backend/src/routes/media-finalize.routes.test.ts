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
 * La consigne obligatoire s'appliquait à la publication ; elle s'applique maintenant à la
 * finalisation de l'upload (Phase 50). Le corps de `finalize` était jusqu'ici INEXISTANT :
 * tout ce qui finalise aujourd'hui — l'interface, un DCC via l'API v1, un test de bout en
 * bout — poste sans corps du tout. En Express 5, `req.body` vaut alors `undefined`, et un
 * `z.object({…})` nu le refuserait en 400 : plus un seul upload n'aboutirait. C'est
 * exactement la faute déjà corrigée sur `publish`, et c'est ce que ce fichier verrouille.
 */
describe('POST /api/media/:id/finalize — la consigne d’upload est facultative', () => {
  it('finalise sans aucun corps (ni contenu, ni en-tête de type)', async () => {
    const res = await request(app).post('/api/media/12/finalize');

    expect(res.status).toBe(200);
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 12, undefined);
  });

  it('finalise avec un corps vide (`{}`)', async () => {
    const res = await request(app).post('/api/media/12/finalize').send({});

    expect(res.status).toBe(200);
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 12, undefined);
  });

  it('transmet la consigne quand elle est là', async () => {
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

  it('refuse une consigne qui n’est pas du texte, sans appeler le service', async () => {
    const res = await request(app).post('/api/media/12/finalize').send({ note: 42 });

    expect(res.status).toBe(400);
    expect(finalize).not.toHaveBeenCalled();
  });

  it('remonte le refus du service — code métier, pas 500', async () => {
    const { AppError } = await import('../lib/errors');
    finalize.mockRejectedValue(
      new AppError('This project requires a note with every upload', 400, 'UPLOAD_NOTE_REQUIRED'),
    );

    const res = await request(app).post('/api/media/12/finalize');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UPLOAD_NOTE_REQUIRED');
  });
});
