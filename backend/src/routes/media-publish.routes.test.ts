// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { publish } = vi.hoisted(() => ({ publish: vi.fn() }));

vi.mock('../middleware/auth', () => ({
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
 * Publier prend désormais la liste des ReViewers et leurs consignes. Le corps reste
 * FACULTATIF, et c'est la moitié qu'on oublie : tout ce qui publiait hier — un DCC, une
 * intégration, un test de bout en bout — poste sans corps du tout. En Express 5, `req.body`
 * vaut alors `undefined`, et un `z.object({…})` nu le refuse en 400 : la publication
 * s'arrêtait net, et avec elle le verrou d'édition qu'elle est censée poser.
 */
describe('POST /api/media/:id/publish — le corps est facultatif', () => {
  it('publie sans aucun corps (ni contenu, ni en-tête de type)', async () => {
    const res = await request(app).post('/api/media/12/publish');
    expect(res.status).toBe(200);
    // `undefined`, et non `[]` : ne rien dire ne retire pas les ReViewers déjà confiés.
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 12, undefined);
  });

  it('publie avec un corps vide (`{}`)', async () => {
    const res = await request(app).post('/api/media/12/publish').send({});
    expect(res.status).toBe(200);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 12, undefined);
  });

  it('transmet la liste et ses consignes quand elle est là', async () => {
    const reviewers = [{ userId: 3, note: 'la lumière du 1042' }];
    const res = await request(app).post('/api/media/12/publish').send({ reviewers });
    expect(res.status).toBe(200);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 12, reviewers);
  });

  it('refuse une liste mal formée sans rien publier', async () => {
    const res = await request(app)
      .post('/api/media/12/publish')
      .send({ reviewers: [{ userId: 'trois' }] });
    expect(res.status).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });
});
