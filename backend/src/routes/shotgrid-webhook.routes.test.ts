// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHmac } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * Receiving ShotGrid webhooks.
 *
 * This suite exists because of a complete and silent outage: the connection was born with a random
 * signing secret that nothing displayed, so the site signed with another value, and **all** deliveries
 * came back as 404, including the connection test. The two invariants guarded here are therefore:
 *
 *  1. the secret that ReView shows the administrator is indeed the one it verifies;
 *  2. an unknown token and a wrong signature get the same answer, so that no caller can guess that a token exists.
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

/** Payload of the connection test, as ShotGrid sends it. */
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

/** ShotGrid signature: HMAC-SHA1 of the body bytes, prefixed with the algorithm. */
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
   * The connection test is the very first exchange: it is what said "Failed" in the site's console while
   * nothing explained why.
   */
  it("accepts the connection test signed with the connection's secret", async () => {
    const res = await post(TEST_CONNECTION, sign(TEST_CONNECTION));

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true });
  });

  it('accepts a signed event and queues it', async () => {
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

  it('rejects a signature computed with another secret', async () => {
    const res = await post(TEST_CONNECTION, sign(TEST_CONNECTION, 'le-secret-du-site'));

    expect(res.status).toBe(404);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('rejects an unsigned delivery when the connection carries a secret', async () => {
    const res = await post(TEST_CONNECTION);

    expect(res.status).toBe(404);
    expect(enqueue).not.toHaveBeenCalled();
  });

  /** The signature covers the bytes: a body altered after signing no longer passes. */
  it('rejects a body altered after signing', async () => {
    const signature = sign(TEST_CONNECTION);
    const res = await post(TEST_CONNECTION.replace('test_connection', 'autre_chose'), signature);

    expect(res.status).toBe(404);
  });

  it('answers exactly the same for an unknown token', async () => {
    db.shotgridConnection.findUnique.mockResolvedValue(null);
    const unknown = await post(TEST_CONNECTION, sign(TEST_CONNECTION));

    db.shotgridConnection.findUnique.mockResolvedValue({ id: 1, webhookSecret: 'chiffré' });
    const wrongSignature = await post(TEST_CONNECTION, sign(TEST_CONNECTION, 'autre'));

    expect(unknown.status).toBe(wrongSignature.status);
    expect(unknown.body).toEqual(wrongSignature.body);
  });

  /**
   * A changed encryption key makes the secret unreadable. That is a configuration outage, not a site
   * outage: surfacing it as a 500 would make ShotGrid believe ReView is broken, and would invite it to
   * retry indefinitely.
   */
  it('does not let an unreadable secret surface as a server error', async () => {
    secretOf.mockImplementation(() => {
      throw new Error('clé de chiffrement invalide');
    });
    const res = await post(TEST_CONNECTION, sign(TEST_CONNECTION));

    expect(res.status).toBe(404);
  });

  it('rejects a body that is not JSON', async () => {
    const body = 'pas du json';
    const res = await post(body, sign(body));

    expect(res.status).toBe(400);
  });

  /**
   * Without a stored secret, the signature is not required: this is the mode of a connection whose
   * secret the administrator has erased, and it must remain workable.
   */
  it('accepts without a signature when the connection has no secret', async () => {
    secretOf.mockReturnValue(null);
    const res = await post(TEST_CONNECTION);

    expect(res.status).toBe(202);
  });
});
