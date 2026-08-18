// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { badRequest } from '../lib/errors';
import * as AuditService from '../services/AuditService';
import * as SmtpService from '../services/SmtpService';
import * as UserService from '../services/UserService';
import { resolveUserLocale } from '../lib/settings';
import { sendMail } from '../lib/mailer';
import { mailLayout } from '../lib/mailTemplate';
import { t } from '../i18n';

/** Relais SMTP sortant du studio (admin) : lecture, écriture et test d'envoi. */
const router = Router();
router.use(authenticate, requireRole(Role.ADMIN));

const smtpSchema = z.object({
  host: z.string().max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  user: z.string().max(255).optional(),
  from: z.string().max(255).optional(),
  password: z.string().max(255).optional(), // write-only (jamais renvoyé)
});

// GET /api/studio/smtp — config SMTP sans mot de passe (admin)
router.get('/smtp', async (_req, res) => {
  res.json({ smtp: await SmtpService.getPublicConfig() });
});

// PUT /api/studio/smtp — enregistre la config (mot de passe chiffré, write-only) (admin)
router.put('/smtp', validate({ body: smtpSchema }), async (req, res) => {
  const smtp = await SmtpService.setConfig(req.body);
  // Le relais SMTP sortant est un pivot : qui le change peut detourner tout le courrier
  // de l'instance. Jamais le mot de passe dans le journal, seulement le fait du changement.
  AuditService.logAudit({
    userId: req.user!.id,
    action: 'SMTP_UPDATE',
    entityType: 'Setting',
    metadata: { host: req.body.host ?? null, passwordChanged: req.body.password !== undefined },
  });
  res.json({ smtp });
});

// POST /api/studio/smtp/test — envoie un email de test (admin)
router.post('/smtp/test', validate({ body: z.object({ to: z.string().email() }) }), async (req, res) => {
  // L'email part dans la langue de l'admin qui déclenche le test : c'est lui qui le lit.
  const locale = await resolveUserLocale(await UserService.getPreferences(req.user!.id));
  const ok = await sendMail(
    req.body.to,
    t(locale, 'smtp.test.subject'),
    mailLayout(locale, t(locale, 'smtp.test.title'), `<p>${t(locale, 'smtp.test.body')}</p>`),
  );
  if (!ok) throw badRequest('Could not send (SMTP not configured, or a delivery error)', 'SMTP_SEND_FAILED');
  res.json({ sent: true });
});

export default router;
