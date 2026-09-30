// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHmac } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * Réception des webhooks ShotGrid.
 *
 * Cette suite existe à cause d'une panne complète et silencieuse : la connexion naissait
 * avec un secret de signature aléatoire que rien n'affichait, le site signait donc avec
 * une autre valeur, et **toutes** les livraisons repartaient en 404 — y compris le test
 * de connexion. Les deux invariants gardés ici sont donc :
 *
 *  1. le secret que ReView montre à l'administrateur est bien celui qu'il vérifie ;
 *  2. un jeton inconnu et une signature fausse répondent la même chose, pour qu'aucun
 *     appelant ne puisse deviner qu'un jeton existe.
 */

const { db, secretOf, enqueue } = vi.hoisted(() => ({
  db: { shotgridConnection: { findUnique: vi.fn(), update: vi.fn() } },
  secretOf: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../lib/settings', () => ({ getSourceUrl: vi.fn(async () => 'https://example.invalid/src') }));
vi.mock('../middleware/rateLimit', () => ({
  rateLimit: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../services/shotgrid/ShotgridConfigService', () => ({
  webhookSecretOf: (...a: unknown[]) => secretOf(...a),
}));
vi.mock('../services/shotgrid/ShotgridEventService', () => ({
  enqueueShotgridEvent: (...a: unknown[]) => enqueue(...a),
}));

import express from 'express';
import request from 'supertest';
import webhookRoutes from './shotgrid-webhook.routes';

const app = express().use('/api/shotgrid/webhook', webhookRoutes);

const TOKEN = 'MkAiuQeyvTHDCCe8fm5E-HSYp0pb90Gu';
const SECRET = 'un-secret-de-signature';

/** Charge utile du test de connexion, telle que ShotGrid l'envoie. */
const TEST_CONNECTION = JSON.stringify({
  data: {
    id: '1925227.145830.0',
    meta: { type: 'test_connection', entity_id: 'null', entity_type: 'null' },
    entity: { id: 0, type: null },
    operation: 'test_connection',
    event_type: 'Test_Connection',
  },
  timestamp: '2026-09-12T14:14:09Z',
});

/** Signature ShotGrid : HMAC-SHA1 des octets du corps, préfixée de l'algorithme. */
const sign = (body: string, secret = SECRET) =>
  `sha1=${createHmac('sha1', secret).update(Buffer.from(body, 'utf8')).digest('hex')}`;

beforeEach(() => {
  vi.clearAllMocks();
  db.shotgridConnection.findUnique.mockResolvedValue({
    id: 1,
    webhookToken: TOKEN,
    webhookSecret: 'chiffré',
  });
  db.shotgridConnection.update.mockResolvedValue({});
  secretOf.mockReturnValue(SECRET);
  enqueue.mockResolvedValue(undefined);
});

const post = (body: string, signature?: string) => {
  const req = request(app).post(`/api/shotgrid/webhook/${TOKEN}`).set('Content-Type', 'application/json');
  if (signature) req.set('x-sg-signature', signature);
  return req.send(body);
};

describe('POST /api/shotgrid/webhook/:token', () => {
  /**
   * Le test de connexion est le tout premier échange : c'est lui qui disait « Failed »
   * dans la console du site pendant que rien n'expliquait pourquoi.
   */
  it('accepte le test de connexion signé avec le secret de la connexion', async () => {
    const res = await post(TEST_CONNECTION, sign(TEST_CONNECTION));

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true });
  });

  it('accepte un événement signé et le met en file', async () => {
    const body = JSON.stringify({
      data: { event_type: 'Shotgun_Shot_Change', entity: { id: 25564, type: 'Shot' } },
    });
    const res = await post(body, sign(body));

    expect(res.status).toBe(202);
    expect(enqueue).toHaveBeenCalledWith(1, expect.objectContaining({ data: expect.anything() }), {
      deliveryId: null,
      batchId: null,
    });
  });

  it('refuse une signature calculée avec un autre secret', async () => {
    const res = await post(TEST_CONNECTION, sign(TEST_CONNECTION, 'le-secret-du-site'));

    expect(res.status).toBe(404);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('refuse une livraison non signée quand la connexion porte un secret', async () => {
    const res = await post(TEST_CONNECTION);

    expect(res.status).toBe(404);
    expect(enqueue).not.toHaveBeenCalled();
  });

  /** La signature porte sur les octets : un corps modifié après coup ne passe plus. */
  it('refuse un corps altéré après signature', async () => {
    const signature = sign(TEST_CONNECTION);
    const res = await post(TEST_CONNECTION.replace('test_connection', 'autre_chose'), signature);

    expect(res.status).toBe(404);
  });

  it('répond exactement pareil pour un jeton inconnu', async () => {
    db.shotgridConnection.findUnique.mockResolvedValue(null);
    const unknown = await post(TEST_CONNECTION, sign(TEST_CONNECTION));

    db.shotgridConnection.findUnique.mockResolvedValue({ id: 1, webhookSecret: 'chiffré' });
    const wrongSignature = await post(TEST_CONNECTION, sign(TEST_CONNECTION, 'autre'));

    expect(unknown.status).toBe(wrongSignature.status);
    expect(unknown.body).toEqual(wrongSignature.body);
  });

  /**
   * Une clé de chiffrement changée rend le secret illisible. C'est une panne de
   * configuration, pas une panne du site : la faire remonter en 500 ferait croire à
   * ShotGrid que ReView est cassé, et l'inviterait à réessayer indéfiniment.
   */
  it('ne laisse pas un secret illisible remonter en erreur serveur', async () => {
    secretOf.mockImplementation(() => {
      throw new Error('clé de chiffrement invalide');
    });
    const res = await post(TEST_CONNECTION, sign(TEST_CONNECTION));

    expect(res.status).toBe(404);
  });

  it('refuse un corps qui n’est pas du JSON', async () => {
    const body = 'pas du json';
    const res = await post(body, sign(body));

    expect(res.status).toBe(400);
  });

  /**
   * Sans secret enregistré, la signature n'est pas exigée : c'est le mode d'une connexion
   * dont l'administrateur a effacé le secret, et il doit rester traitable.
   */
  it('accepte sans signature quand la connexion n’a pas de secret', async () => {
    secretOf.mockReturnValue(null);
    const res = await post(TEST_CONNECTION);

    expect(res.status).toBe(202);
  });
});
