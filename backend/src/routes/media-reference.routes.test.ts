// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * La position d'une image de référence n'était bornée nulle part, puis l'a été à 0..1 — ce qui
 * collait la référence d'office SUR le média. Elle doit pouvoir se poser **à côté**, dans les
 * bandes du letterbox : le schéma laisse donc passer le débordement utile et ne refuse que
 * l'aberrant, celui qu'aucun viewer ne montre et que personne ne peut rattraper.
 */
const { add, remove } = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn() }));

vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 7, email: 'artist@studio.com', role: 'ARTIST' };
    next();
  },
}));
vi.mock('../services/ReviewReferenceService', () => ({ add, remove }));

import express from 'express';
import request from 'supertest';
import referenceRoutes from './media-reference.routes';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/media', referenceRoutes).use(errorHandler);

const body = (pos: Record<string, number>) => ({
  dataUrl: 'data:image/png;base64,AA',
  commentId: 3,
  ...pos,
});
const post = (pos: Record<string, number>) => request(app).post('/api/media/5/references').send(body(pos));

beforeEach(() => {
  vi.clearAllMocks();
  add.mockResolvedValue({ id: 1, url: 'u', x: 0.1, y: 0.1, width: 0.3, commentId: 3 });
});

describe('POST /api/media/:id/references — position bornée à l’atteignable', () => {
  it('accepte une position dans le cadre', async () => {
    const res = await post({ x: 0.5, y: 0.25, width: 0.3 });
    expect(res.status).toBe(201);
    expect(add).toHaveBeenCalledWith(expect.anything(), 5, 'data:image/png;base64,AA', 3, {
      x: 0.5,
      y: 0.25,
      width: 0.3,
    });
  });

  it('accepte une référence posée À CÔTÉ du média, dans la bande du letterbox', async () => {
    expect((await post({ x: 1.05, y: 0.02, width: 0.3 })).status).toBe(201);
    expect((await post({ x: -0.32, y: 0.02, width: 0.3 })).status).toBe(201);
    expect(add).toHaveBeenCalledTimes(2);
  });

  it('refuse une position aberrante sans rien écrire', async () => {
    expect((await post({ x: 12, y: 0, width: 0.3 })).status).toBe(400);
    expect((await post({ x: 0.2, y: -8, width: 0.3 })).status).toBe(400);
    expect(add).not.toHaveBeenCalled();
  });

  it('refuse une largeur hors bornes', async () => {
    expect((await post({ x: 0, y: 0, width: 3 })).status).toBe(400);
    expect((await post({ x: 0, y: 0, width: 0 })).status).toBe(400);
    expect(add).not.toHaveBeenCalled();
  });

  it('accepte une requête sans position (le service pose ses valeurs)', async () => {
    expect((await post({})).status).toBe(201);
  });
});
