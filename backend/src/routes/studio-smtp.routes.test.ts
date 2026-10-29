// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * A3-04: the internal relay's escape hatch without TLS must be REACHABLE.
 *
 * `SmtpService` can read `allowInsecure` and `lib/mailer` takes it into account, but this route's Zod
 * schema did not declare it: `z.object` strips unknown fields, so the setting never reached the database.
 * Operational consequence: a studio whose relay does not announce STARTTLS could no longer send a single
 * email, invitations included, without any recourse through the API.
 *
 * Second part: when the stored password can no longer be decrypted, sending is refused (fail closed,
 * correct), but the administrator must read WHY, not "not configured".
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

/** Default public configuration: healthy relay, readable password. */
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

describe('PUT /api/studio/smtp — internal relay escape hatch (A3-04)', () => {
  it('passes allowInsecure on to the service instead of letting Zod strip it', async () => {
    const res = await request(app)
      .put('/api/studio/smtp')
      .send({ host: 'relais.interne', port: 25, allowInsecure: true });
    expect(res.status).toBe(200);
    expect(smtp.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'relais.interne', allowInsecure: true }),
    );
  });

  it('also passes the return to security (allowInsecure: false)', async () => {
    await request(app).put('/api/studio/smtp').send({ allowInsecure: false });
    expect(smtp.setConfig).toHaveBeenCalledWith(expect.objectContaining({ allowInsecure: false }));
  });

  it('leaves the setting in place when the request does not mention it', async () => {
    await request(app).put('/api/studio/smtp').send({ host: 'smtp.studio' });
    expect((smtp.setConfig.mock.calls[0]![0] as Record<string, unknown>).allowInsecure).toBeUndefined();
  });

  it('rejects a value that is not a boolean', async () => {
    const res = await request(app).put('/api/studio/smtp').send({ allowInsecure: 'oui' });
    expect(res.status).toBe(400);
    expect(smtp.setConfig).not.toHaveBeenCalled();
  });

  it('records the switch to plaintext in the audit log', async () => {
    await request(app).put('/api/studio/smtp').send({ host: 'relais.interne', allowInsecure: true });
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SMTP_UPDATE',
        metadata: expect.objectContaining({ allowInsecure: true }),
      }),
    );
  });

  it('leaves a pino trace at the time of the decision', async () => {
    smtp.setConfig.mockResolvedValue(publicConfig({ allowInsecure: true, host: 'relais.interne' }));
    await request(app).put('/api/studio/smtp').send({ host: 'relais.interne', allowInsecure: true });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'relais.interne', userId: 1 }),
      expect.stringContaining('[smtp]'),
    );
  });

  it('says nothing when the relay stays encrypted', async () => {
    await request(app).put('/api/studio/smtp').send({ host: 'smtp.studio' });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('never writes the password in the audit log', async () => {
    await request(app).put('/api/studio/smtp').send({ host: 'smtp.studio', password: 'tres-secret' });
    const { metadata } = audit.logAudit.mock.calls[0]![0] as { metadata: Record<string, unknown> };
    expect(JSON.stringify(metadata)).not.toContain('tres-secret');
    expect(metadata.passwordChanged).toBe(true);
  });
});

describe('POST /api/studio/smtp/test — saying why the send does not go out (A3-03)', () => {
  it('names the unreadable password instead of "not configured"', async () => {
    sendMail.mockResolvedValue(false);
    smtp.getPublicConfig.mockResolvedValue(publicConfig({ passwordUnreadable: true }));
    const res = await request(app).post('/api/studio/smtp/test').send({ to: 'admin@studio.com' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SMTP_PASSWORD_UNREADABLE');
  });

  it('keeps the generic message for an ordinary delivery failure', async () => {
    sendMail.mockResolvedValue(false);
    const res = await request(app).post('/api/studio/smtp/test').send({ to: 'admin@studio.com' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SMTP_SEND_FAILED');
  });

  it('responds 200 when the message goes out', async () => {
    const res = await request(app).post('/api/studio/smtp/test').send({ to: 'admin@studio.com' });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
  });
});
