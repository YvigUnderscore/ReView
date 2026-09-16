// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A1-04 / A2-06 — la clé d'avatar se compare sur un motif ancré, pas sur un préfixe.
 *
 * En décimal, l'identifiant d'un compte est souvent le préfixe d'un autre : `avatars/9`
 * couvrait `avatars/91.png`. Le contrôle doit se fermer sur l'extension, sinon il n'est
 * pas un contrôle d'appartenance mais un contrôle de dossier.
 */
const { setAvatar, presignAvatar } = vi.hoisted(() => ({
  setAvatar: vi.fn(),
  presignAvatar: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: 9, role: 'ARTIST', email: 'a@b.c' };
    next();
  },
}));
vi.mock('../services/UserService', () => ({ setAvatar, presignAvatar, getProfile: vi.fn() }));

import express from 'express';
import request from 'supertest';
import profileRoutes from './users-profile.routes';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/users', profileRoutes).use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  setAvatar.mockResolvedValue({ id: 9 });
});

describe('PUT /api/users/me/avatar — appartenance de la clé', () => {
  it("refuse la clé d'un compte dont l'identifiant commence par le sien", async () => {
    const res = await request(app).put('/api/users/me/avatar').send({ key: 'avatars/91.png' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_KEY');
    expect(setAvatar).not.toHaveBeenCalled();
  });

  it('refuse une clé hors du dossier des avatars', async () => {
    for (const key of ['derived/9/thumbnail.png', 'avatars/9/../91.png', 'avatars/09.png']) {
      const res = await request(app).put('/api/users/me/avatar').send({ key });
      expect(res.status).toBe(400);
    }
    expect(setAvatar).not.toHaveBeenCalled();
  });

  it('accepte les trois formes que produit la présignature, et le retrait', async () => {
    for (const key of ['avatars/9.png', 'avatars/9.jpg', 'avatars/9.webp', null]) {
      const res = await request(app).put('/api/users/me/avatar').send({ key });
      expect(res.status).toBe(200);
      expect(setAvatar).toHaveBeenCalledWith(9, key);
    }
  });
});
