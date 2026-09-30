// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, tx } = vi.hoisted(() => {
  const tx = { studio: { count: vi.fn(), create: vi.fn() }, user: { create: vi.fn() } };
  return {
    tx,
    db: {
      studio: { count: vi.fn() },
      // Le callback reçoit le client transactionnel : c'est LUI qui doit porter le comptage.
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
 * Route publique par nature : elle crée le premier compte ADMIN sans authentification.
 * Comptée hors transaction, deux requêtes concurrentes lisent toutes deux « zéro studio »
 * et créent chacune un studio et un ADMIN — `Studio.slug @unique` ne rattrape que des noms
 * identiques.
 */
describe('POST /api/setup — unicité de l’installation', () => {
  it('installe l’instance quand aucun studio n’existe', async () => {
    const res = await request(app).post('/api/setup').send(body);
    expect(res.status).toBe(201);
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'admin@studio.com', role: 'ADMIN' }),
      }),
    );
  });

  it('compte les studios DANS la transaction, pas seulement avant', async () => {
    await request(app).post('/api/setup').send(body);
    expect(tx.studio.count).toHaveBeenCalled();
  });

  it('demande explicitement le niveau Serializable', async () => {
    await request(app).post('/api/setup').send(body);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('refuse dès qu’un studio existe (contrôle rapide, hors transaction)', async () => {
    db.studio.count.mockResolvedValue(1);
    const res = await request(app).post('/api/setup').send(body);
    expect(res.status).toBe(409);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  // La course : le contrôle rapide passe, mais un studio est apparu entre-temps.
  it('refuse quand le studio apparaît pendant la transaction', async () => {
    tx.studio.count.mockResolvedValue(1);
    const res = await request(app).post('/api/setup').send(body);
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('ALREADY_SETUP');
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  // Ce que PostgreSQL renvoie à la transaction perdante : un conflit de sérialisation.
  it('traduit le conflit de sérialisation en refus d’installation, pas en panne', async () => {
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
