// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate, requireUser } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { badRequest } from '../lib/errors';
import { logger } from '../lib/logger';
import * as AuditService from '../services/AuditService';
import * as SmtpService from '../lib/smtpSettings';
import * as UserService from '../services/UserService';
import { resolveUserLocale } from '../lib/settings';
import { sendMail } from '../lib/mailer';
import { mailLayout } from '../lib/mailTemplate';
import { t } from '../i18n';

/** The studio's outgoing SMTP relay (admin): read, write, and test send. */
const router = Router();
router.use(authenticate, requireRole(Role.ADMIN));

const smtpSchema = z.object({
  host: z.string().max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  user: z.string().max(255).optional(),
  from: z.string().max(255).optional(),
  password: z.string().max(255).optional(), // write-only (never returned)
  /**
   * Accepted escape hatch for the internal relay without a certificate (cf. `SmtpService`).
   *
   * Without this line, Zod stripped it from the body (`z.object` strips unknown fields), and the setting
   * never reached the database: a studio whose relay does not announce STARTTLS no longer had any recourse
   * through the API to put its emails back on track. When omitted, the value in place is kept; when set,
   * it is explicit and audited.
   */
  allowInsecure: z.boolean().optional(),
});

// GET /api/studio/smtp — SMTP config without the password (admin)
router.get('/smtp', async (_req, res) => {
  res.json({ smtp: await SmtpService.getPublicConfig() });
});

// PUT /api/studio/smtp — records the config (password encrypted, write-only) (admin)
router.put('/smtp', validate({ body: smtpSchema }), async (req, res) => {
  const smtp = await SmtpService.setConfig(req.body);
  // `lib/mailer` warns only once per process, at the first send: in a backend that runs for weeks, the
  // line is far behind when one looks for why the SMTP traffic is in clear. The moment of the DECISION,
  // for its part, is always found.
  if (smtp.allowInsecure)
    logger.warn(
      { host: smtp.host, userId: requireUser(req).id },
      '[smtp] plaintext dialogue allowed for this relay: credentials and invitation links will travel unencrypted.',
    );
  // The outgoing SMTP relay is a pivot: whoever changes it can divert all the instance's mail.
  // Never the password in the log, only the fact of the change.
  AuditService.logAudit({
    userId: requireUser(req).id,
    action: 'SMTP_UPDATE',
    entityType: 'Setting',
    // `allowInsecure` puts the SMTP credentials and the invitation links back in clear on the network: the
    // gesture must be dated and attributed, not merely effective.
    metadata: {
      host: req.body.host ?? null,
      passwordChanged: req.body.password !== undefined,
      allowInsecure: req.body.allowInsecure ?? null,
    },
  });
  res.json({ smtp });
});

// POST /api/studio/smtp/test — sends a test email (admin)
router.post('/smtp/test', validate({ body: z.object({ to: z.string().email() }) }), async (req, res) => {
  // The email goes out in the language of the admin who triggers the test: it is they who read it.
  const locale = await resolveUserLocale(await UserService.getPreferences(requireUser(req).id));
  const ok = await sendMail(
    req.body.to,
    t(locale, 'smtp.test.subject'),
    mailLayout(locale, t(locale, 'smtp.test.title'), `<p>${t(locale, 'smtp.test.body')}</p>`),
  );
  if (!ok) {
    // A send refused because the stored secret can no longer be decrypted (key rotation) looked like
    // "not configured": the admin re-entered host and port without repairing anything. The cause is
    // named here, since the only useful action is to re-enter the password.
    if ((await SmtpService.getPublicConfig()).passwordUnreadable)
      throw badRequest(
        'Stored SMTP password can no longer be decrypted — re-enter it',
        'SMTP_PASSWORD_UNREADABLE',
      );
    throw badRequest('Could not send (SMTP not configured, or a delivery error)', 'SMTP_SEND_FAILED');
  }
  res.json({ sent: true });
});

export default router;
