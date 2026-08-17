// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: { setting: { findUnique: vi.fn() } },
}));

import express from 'express';
import request from 'supertest';
import docsRoutes from './docs.routes';
import { prisma } from '../lib/prisma';

const findUnique = vi.mocked(prisma.setting.findUnique);
const app = express().use('/api', docsRoutes);

beforeEach(() => vi.clearAllMocks());

/**
 * `/api/docs` est servi sans authentification : c'est une surface réseau au sens de
 * l'AGPL §13, au même titre que la page de connexion. Elle doit donc porter la mention
 * légale et l'offre du code source correspondant.
 */
describe('GET /api/docs — surface publique', () => {
  it('porte copyright, licence, absence de garantie et lien source', async () => {
    findUnique.mockResolvedValue({ value: 'https://git.studio.tld/review' } as never);
    const res = await request(app).get('/api/docs');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Copyright © 2026 Yvig Bidon');
    expect(res.text).toContain('AGPL-3.0-or-later');
    expect(res.text).toContain('sans aucune garantie');
    expect(res.text).toContain('href="https://git.studio.tld/review"');
  });

  it('retombe sur le dépôt amont quand le réglage studio est vide', async () => {
    findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/docs');
    expect(res.text).toContain('href="https://github.com/YvigUnderscore/ReView"');
  });

  it('n’injecte pas une URL de réglage hostile dans l’attribut href', async () => {
    findUnique.mockResolvedValue({ value: 'javascript:alert(1)' } as never);
    const res = await request(app).get('/api/docs');
    expect(res.text).not.toContain('javascript:');
    expect(res.text).toContain('href="https://github.com/YvigUnderscore/ReView"');
  });

  it('déclare la licence dans le document OpenAPI, lui aussi public', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.info.license).toEqual({
      name: 'AGPL-3.0-or-later',
      url: 'https://www.gnu.org/licenses/agpl-3.0.html',
    });
  });
});
