// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * A3-04: the complete chain, with no mock in the middle.
 *
 * The unit tests check each link separately: the route talks to the service, the service returns
 * `allowInsecure`, the transport takes it into account. This is exactly how a setting can be written,
 * tested and yet be inoperative, which was the case: the route's Zod schema stripped it from the body,
 * and no test crossed the junction.
 *
 * Here, only the EDGES are simulated (the database and nodemailer): in between, the real route, the real
 * `SmtpService` and the real `lib/mailer`.
 */
const { store, createTransport, transport } = vi.hoisted(() => ({
  store: { value: null as string | null },
  createTransport: vi.fn(),
  transport: { sendMail: vi.fn() },
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    setting: {
      findUnique: vi.fn(() =>
        Promise.resolve(store.value === null ? null : { key: 'smtp_config', value: store.value }),
      ),
      upsert: vi.fn((args: { create: { value: string } }) => {
        store.value = args.create.value;
        return Promise.resolve({});
      }),
    },
  },
}));
vi.mock('../config/env', () => ({
  env: {
    SMTP_HOST: undefined,
    SMTP_PASS: undefined,
    SMTP_USER: undefined,
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    SMTP_FROM: 'ReView <no-reply@test>',
    JWT_SECRET: 'secret-de-test',
    APP_ENCRYPTION_KEY: 'cle-de-test',
  },
}));
vi.mock('nodemailer', () => ({ default: { createTransport } }));
vi.mock('../middleware/auth', async () => ({
  ...(await import('../middleware/authUser')),
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 1, email: 'admin@studio.com', role: 'ADMIN' };
    next();
  },
}));
vi.mock('../middleware/rbac', () => ({
  requireRole: () => (_r: Request, _s: Response, n: NextFunction) => n(),
}));
vi.mock('../services/AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('../services/UserService', () => ({ getPreferences: vi.fn(() => Promise.resolve({})) }));
vi.mock('../lib/settings', () => ({ resolveUserLocale: vi.fn(() => Promise.resolve('en')) }));
vi.mock('../lib/mailTemplate', () => ({ mailLayout: (_l: string, _t: string, b: string) => b }));
vi.mock('../i18n', () => ({ t: (_locale: string, key: string) => key }));
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import express from 'express';
import request from 'supertest';
import smtpRoutes from './studio-smtp.routes';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/studio', smtpRoutes).use(errorHandler);

/** Options handed to nodemailer for the last send. */
const lastTransportOptions = () =>
  createTransport.mock.calls[createTransport.mock.calls.length - 1]![0] as { requireTLS?: boolean };

beforeEach(() => {
  vi.clearAllMocks();
  store.value = null;
  createTransport.mockReturnValue(transport);
  transport.sendMail.mockResolvedValue({});
});

describe('from the administration screen to the nodemailer transport', () => {
  it('requires STARTTLS as long as the administrator has asked for nothing', async () => {
    await request(app).put('/api/studio/smtp').send({ host: 'smtp.studio', port: 587 });
    const res = await request(app).post('/api/studio/smtp/test').send({ to: 'admin@studio.com' });
    expect(res.status).toBe(200);
    expect(lastTransportOptions().requireTLS).toBe(true);
  });

  it('opens the plaintext channel when the administrator sets the escape hatch', async () => {
    const put = await request(app)
      .put('/api/studio/smtp')
      .send({ host: 'relais.interne', port: 25, allowInsecure: true });
    // What the screen reads back must state the setting: otherwise it would be set without being seen.
    expect(put.body.smtp.allowInsecure).toBe(true);
    expect((await request(app).get('/api/studio/smtp')).body.smtp.allowInsecure).toBe(true);

    await request(app).post('/api/studio/smtp/test').send({ to: 'admin@studio.com' });
    expect(lastTransportOptions().requireTLS).toBe(false);
    expect(lastTransportOptions()).toMatchObject({ host: 'relais.interne', port: 25 });
  });

  it('closes the plaintext channel with the reverse action', async () => {
    await request(app).put('/api/studio/smtp').send({ host: 'relais.interne', allowInsecure: true });
    await request(app).put('/api/studio/smtp').send({ allowInsecure: false });
    expect((await request(app).get('/api/studio/smtp')).body.smtp.allowInsecure).toBe(false);
    await request(app).post('/api/studio/smtp/test').send({ to: 'admin@studio.com' });
    expect(lastTransportOptions().requireTLS).toBe(true);
  });
});
