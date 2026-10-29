// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, tx } = vi.hoisted(() => {
  const tx = { studio: { count: vi.fn(), create: vi.fn() }, user: { create: vi.fn() } };
  return {
    tx,
    db: {
      studio: { count: vi.fn() },
      // The callback receives the transactional client: IT must carry the count.
      $transaction: vi.fn(
        async (fn: (c: typeof tx) => Promise<unknown>, _opts?: { isolationLevel?: string }) => fn(tx),
      ),
    },
  };
});

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/sessions', () => ({ createSession: vi.fn().mockResolvedValue('sid-1') }));

import express from 'express';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import setupRoutes from './setup.routes';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/setup', setupRoutes).use(errorHandler);

const body = {
  studioName: 'Studio Nord',
  adminEmail: 'Admin@Studio.com',
  adminPassword: 'Motdepasse1',
};

beforeEach(() => {
  vi.clearAllMocks();
  db.studio.count.mockResolvedValue(0);
  tx.studio.count.mockResolvedValue(0);
  tx.studio.create.mockResolvedValue({ id: 1, name: 'Studio Nord', slug: 'studio-nord' });
  tx.user.create.mockResolvedValue({ id: 1, email: 'admin@studio.com', name: null, role: 'ADMIN' });
});

/**
 * A public route by nature: it creates the first ADMIN account without authentication. Counted outside a
 * transaction, two concurrent requests both read "zero studios" and each create a studio and an ADMIN:
 * `Studio.slug @unique` only catches identical names.
 */
describe('POST /api/setup — uniqueness of the installation', () => {
  it('installs the instance when no studio exists', async () => {
    const res = await request(app).post('/api/setup').send(body);
    expect(res.status).toBe(201);
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'admin@studio.com', role: 'ADMIN' }),
      }),
    );
  });

  it('counts the studios INSIDE the transaction, not only before it', async () => {
    await request(app).post('/api/setup').send(body);
    expect(tx.studio.count).toHaveBeenCalled();
  });

  it('explicitly requests the Serializable level', async () => {
    await request(app).post('/api/setup').send(body);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('rejects as soon as a studio exists (fast check, outside the transaction)', async () => {
    db.studio.count.mockResolvedValue(1);
    const res = await request(app).post('/api/setup').send(body);
    expect(res.status).toBe(409);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  // The race: the fast check passes, but a studio appeared in the meantime.
  it('rejects when the studio appears during the transaction', async () => {
    tx.studio.count.mockResolvedValue(1);
    const res = await request(app).post('/api/setup').send(body);
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('ALREADY_SETUP');
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  // What PostgreSQL returns to the losing transaction: a serialization conflict.
  it('translates the serialization conflict into an installation refusal, not an outage', async () => {
    db.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('write conflict', {
        code: 'P2034',
        clientVersion: 'test',
      }),
    );
    const res = await request(app).post('/api/setup').send(body);
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('ALREADY_SETUP');
  });
});
