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
 * Antivirus gateways and mail proxies (SafeLinks and the like) preload the links of messages: a GET that
 * unsubscribes unsubscribes by itself, without the recipient having clicked. The link received by email
 * remains valid, but it only shows a confirmation request.
 */
describe('GET /api/unsubscribe/:token — changes nothing', () => {
  it('does not write the preference', async () => {
    const res = await request(app).get(`/api/unsubscribe/${token}`);
    expect(res.status).toBe(200);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('offers a button that POSTs to the confirmation', async () => {
    const res = await request(app).get(`/api/unsubscribe/${token}`);
    expect(res.text).toContain('method="post"');
    expect(res.text).toContain(`action="/api/unsubscribe/${token}/confirm"`);
  });

  it('announces an invalid link without writing anything', async () => {
    const res = await request(app).get(`/api/unsubscribe/${forged}`);
    expect(res.status).toBe(400);
    expect(res.text).not.toContain('method="post"');
    expect(db.user.update).not.toHaveBeenCalled();
  });

  // AGPL §13: public surface, hence a link to the source code.
  it('carries the source code notice', async () => {
    const res = await request(app).get(`/api/unsubscribe/${token}`);
    expect(res.text).toContain('https://example.test/src');
  });
});

describe('POST /api/unsubscribe/:token/confirm — the human click', () => {
  it('switches off the targeted preference and returns a page', async () => {
    const res = await request(app).post(`/api/unsubscribe/${token}/confirm`).send('');
    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { preferences: { emailDigest: false } },
    });
    expect(res.text).toContain('You are unsubscribed');
  });

  it('rejects a forged token', async () => {
    const res = await request(app).post(`/api/unsubscribe/${forged}/confirm`).send('');
    expect(res.status).toBe(400);
    expect(db.user.update).not.toHaveBeenCalled();
  });
});

/**
 * The mail clients' native button (`List-Unsubscribe-Post`): immediate response without a page, and above
 * all undifferentiated: distinguishing a valid token from a forged one would tell a third party whether an
 * account exists.
 */
describe('POST /api/unsubscribe/:token — native button (RFC 8058)', () => {
  it('unsubscribes and responds 204', async () => {
    const res = await request(app)
      .post(`/api/unsubscribe/${token}`)
      .type('form')
      .send('List-Unsubscribe=One-Click');
    expect(res.status).toBe(204);
    expect(db.user.update).toHaveBeenCalled();
  });

  it('responds 204 on a forged token too', async () => {
    const res = await request(app).post(`/api/unsubscribe/${forged}`).send('');
    expect(res.status).toBe(204);
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
