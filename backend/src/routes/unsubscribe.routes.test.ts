// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/settings', () => ({ getSourceUrl: vi.fn().mockResolvedValue('https://example.test/src') }));

import express from 'express';
import request from 'supertest';
import unsubscribeRoutes from './unsubscribe.routes';
import { errorHandler } from '../middleware/error';
import { signUnsubscribe } from '../lib/unsubscribe';

const app = express()
  .use(express.json())
  .use(express.urlencoded({ extended: true }))
  .use('/api/unsubscribe', unsubscribeRoutes)
  .use(errorHandler);

const token = signUnsubscribe(7, 'emailDigest');
const forged = '7.emailDigest.signature-inventee';

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue({ preferences: { emailDigest: true } });
  db.user.update.mockResolvedValue({});
});

/**
 * Les passerelles antivirus et les proxys de messagerie (SafeLinks et assimilés)
 * préchargent les liens des messages : un GET qui désabonne désabonne tout seul, sans
 * que le destinataire ait cliqué. Le lien reçu par mail reste valide, mais il n'affiche
 * qu'une demande de confirmation.
 */
describe('GET /api/unsubscribe/:token — ne modifie rien', () => {
  it('n’écrit pas la préférence', async () => {
    const res = await request(app).get(`/api/unsubscribe/${token}`);
    expect(res.status).toBe(200);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('propose un bouton qui POSTe vers la confirmation', async () => {
    const res = await request(app).get(`/api/unsubscribe/${token}`);
    expect(res.text).toContain('method="post"');
    expect(res.text).toContain(`action="/api/unsubscribe/${token}/confirm"`);
  });

  it('annonce un lien invalide sans rien écrire', async () => {
    const res = await request(app).get(`/api/unsubscribe/${forged}`);
    expect(res.status).toBe(400);
    expect(res.text).not.toContain('method="post"');
    expect(db.user.update).not.toHaveBeenCalled();
  });

  // §13 AGPL : surface publique, donc lien vers le code source.
  it('porte la mention du code source', async () => {
    const res = await request(app).get(`/api/unsubscribe/${token}`);
    expect(res.text).toContain('https://example.test/src');
  });
});

describe('POST /api/unsubscribe/:token/confirm — le clic humain', () => {
  it('éteint la préférence visée et rend une page', async () => {
    const res = await request(app).post(`/api/unsubscribe/${token}/confirm`).send('');
    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { preferences: { emailDigest: false } },
    });
    expect(res.text).toContain('You are unsubscribed');
  });

  it('refuse un jeton forgé', async () => {
    const res = await request(app).post(`/api/unsubscribe/${forged}/confirm`).send('');
    expect(res.status).toBe(400);
    expect(db.user.update).not.toHaveBeenCalled();
  });
});

/**
 * Le bouton natif des messageries (`List-Unsubscribe-Post`) : réponse immédiate et sans
 * page, et surtout indifférenciée — distinguer jeton valide et jeton forgé dirait à un
 * tiers si un compte existe.
 */
describe('POST /api/unsubscribe/:token — bouton natif (RFC 8058)', () => {
  it('désabonne et répond 204', async () => {
    const res = await request(app)
      .post(`/api/unsubscribe/${token}`)
      .type('form')
      .send('List-Unsubscribe=One-Click');
    expect(res.status).toBe(204);
    expect(db.user.update).toHaveBeenCalled();
  });

  it('répond 204 aussi sur un jeton forgé', async () => {
    const res = await request(app).post(`/api/unsubscribe/${forged}`).send('');
    expect(res.status).toBe(204);
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
