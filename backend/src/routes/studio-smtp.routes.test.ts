// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * A3-04 — l'échappatoire du relais interne sans TLS doit être ATTEIGNABLE.
 *
 * `SmtpService` sait lire `allowInsecure` et `lib/mailer` sait en tenir compte, mais le
 * schéma Zod de cette route ne le déclarait pas : `z.object` retire les champs inconnus,
 * le réglage n'arrivait donc jamais jusqu'à la base. Conséquence d'exploitation : un studio
 * dont le relais n'annonce pas STARTTLS ne pouvait plus envoyer un seul mail — invitations
 * comprises — sans aucun recours par l'API.
 *
 * Second volet : quand le mot de passe stocké ne se déchiffre plus, l'envoi est refusé
 * (échec fermé, correct) — mais l'administrateur doit lire POURQUOI, pas « non configuré ».
 */
const { smtp, audit, sendMail } = vi.hoisted(() => ({
  smtp: { setConfig: vi.fn(), getPublicConfig: vi.fn() },
  audit: { logAudit: vi.fn() },
  sendMail: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 1, email: 'admin@studio.com', role: 'ADMIN' };
    next();
  },
}));
vi.mock('../middleware/rbac', () => ({
  requireRole: () => (_r: Request, _s: Response, n: NextFunction) => n(),
}));
vi.mock('../services/SmtpService', () => smtp);
vi.mock('../services/AuditService', () => audit);
vi.mock('../services/UserService', () => ({ getPreferences: vi.fn(() => Promise.resolve({})) }));
vi.mock('../lib/settings', () => ({ resolveUserLocale: vi.fn(() => Promise.resolve('en')) }));
vi.mock('../lib/mailer', () => ({ sendMail }));
vi.mock('../lib/mailTemplate', () => ({ mailLayout: (_l: string, _t: string, b: string) => b }));
vi.mock('../i18n', () => ({ t: (_locale: string, key: string) => key }));
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import express from 'express';
import request from 'supertest';
import smtpRoutes from './studio-smtp.routes';
import { logger } from '../lib/logger';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/studio', smtpRoutes).use(errorHandler);

/** Configuration publique par défaut : relais sain, mot de passe lisible. */
const publicConfig = (over: Record<string, unknown> = {}) => ({
  host: 'smtp.studio',
  port: 587,
  secure: false,
  user: 'studio',
  from: 'ReView <no-reply@studio>',
  hasPassword: true,
  allowInsecure: false,
  passwordUnreadable: false,
  envOverride: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  smtp.setConfig.mockResolvedValue(publicConfig());
  smtp.getPublicConfig.mockResolvedValue(publicConfig());
  sendMail.mockResolvedValue(true);
});

describe('PUT /api/studio/smtp — échappatoire du relais interne (A3-04)', () => {
  it('transmet allowInsecure jusqu’au service au lieu de le laisser stripper par Zod', async () => {
    const res = await request(app)
      .put('/api/studio/smtp')
      .send({ host: 'relais.interne', port: 25, allowInsecure: true });
    expect(res.status).toBe(200);
    expect(smtp.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'relais.interne', allowInsecure: true }),
    );
  });

  it('transmet aussi la remise en sécurité (allowInsecure: false)', async () => {
    await request(app).put('/api/studio/smtp').send({ allowInsecure: false });
    expect(smtp.setConfig).toHaveBeenCalledWith(expect.objectContaining({ allowInsecure: false }));
  });

  it('laisse le réglage en place quand la requête ne le mentionne pas', async () => {
    await request(app).put('/api/studio/smtp').send({ host: 'smtp.studio' });
    expect((smtp.setConfig.mock.calls[0]![0] as Record<string, unknown>).allowInsecure).toBeUndefined();
  });

  it('refuse une valeur qui n’est pas un booléen', async () => {
    const res = await request(app).put('/api/studio/smtp').send({ allowInsecure: 'oui' });
    expect(res.status).toBe(400);
    expect(smtp.setConfig).not.toHaveBeenCalled();
  });

  it('inscrit le passage en clair au journal d’audit', async () => {
    await request(app).put('/api/studio/smtp').send({ host: 'relais.interne', allowInsecure: true });
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SMTP_UPDATE',
        metadata: expect.objectContaining({ allowInsecure: true }),
      }),
    );
  });

  it('laisse une trace pino au moment de la décision', async () => {
    smtp.setConfig.mockResolvedValue(publicConfig({ allowInsecure: true, host: 'relais.interne' }));
    await request(app).put('/api/studio/smtp').send({ host: 'relais.interne', allowInsecure: true });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'relais.interne', userId: 1 }),
      expect.stringContaining('[smtp]'),
    );
  });

  it('ne dit rien quand le relais reste chiffré', async () => {
    await request(app).put('/api/studio/smtp').send({ host: 'smtp.studio' });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('n’écrit jamais le mot de passe dans le journal d’audit', async () => {
    await request(app).put('/api/studio/smtp').send({ host: 'smtp.studio', password: 'tres-secret' });
    const { metadata } = audit.logAudit.mock.calls[0]![0] as { metadata: Record<string, unknown> };
    expect(JSON.stringify(metadata)).not.toContain('tres-secret');
    expect(metadata.passwordChanged).toBe(true);
  });
});

describe('POST /api/studio/smtp/test — dire pourquoi l’envoi ne part pas (A3-03)', () => {
  it('nomme le mot de passe illisible au lieu de « non configuré »', async () => {
    sendMail.mockResolvedValue(false);
    smtp.getPublicConfig.mockResolvedValue(publicConfig({ passwordUnreadable: true }));
    const res = await request(app).post('/api/studio/smtp/test').send({ to: 'admin@studio.com' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SMTP_PASSWORD_UNREADABLE');
  });

  it('garde le message générique pour une panne de livraison ordinaire', async () => {
    sendMail.mockResolvedValue(false);
    const res = await request(app).post('/api/studio/smtp/test').send({ to: 'admin@studio.com' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SMTP_SEND_FAILED');
  });

  it('répond 200 quand le message part', async () => {
    const res = await request(app).post('/api/studio/smtp/test').send({ to: 'admin@studio.com' });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
  });
});
