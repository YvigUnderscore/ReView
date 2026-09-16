// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { badRequest } from '../lib/errors';
import { logger } from '../lib/logger';
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
  /**
   * Échappatoire assumée du relais interne sans certificat (cf. `SmtpService`).
   *
   * Sans cette ligne, Zod la retirait du corps — `z.object` strippe les champs inconnus —
   * et le réglage n'atteignait jamais la base : un studio dont le relais n'annonce pas
   * STARTTLS n'avait plus AUCUN recours par l'API pour remettre ses envois en route.
   * Omise, la valeur en place est conservée ; posée, elle est explicite et auditée.
   */
  allowInsecure: z.boolean().optional(),
});

// GET /api/studio/smtp — config SMTP sans mot de passe (admin)
router.get('/smtp', async (_req, res) => {
  res.json({ smtp: await SmtpService.getPublicConfig() });
});

// PUT /api/studio/smtp — enregistre la config (mot de passe chiffré, write-only) (admin)
router.put('/smtp', validate({ body: smtpSchema }), async (req, res) => {
  const smtp = await SmtpService.setConfig(req.body);
  // `lib/mailer` n'avertit qu'une fois par process, au premier envoi : dans un backend qui
  // tourne des semaines, la ligne est loin derrière quand on cherche pourquoi le trafic
  // SMTP est en clair. Le moment de la DÉCISION, lui, se retrouve toujours.
  if (smtp.allowInsecure)
    logger.warn(
      { host: smtp.host, userId: req.user!.id },
      '[smtp] dialogue en clair autorisé pour ce relais : identifiants et liens d’invitation circuleront sans chiffrement.',
    );
  // Le relais SMTP sortant est un pivot : qui le change peut detourner tout le courrier
  // de l'instance. Jamais le mot de passe dans le journal, seulement le fait du changement.
  AuditService.logAudit({
    userId: req.user!.id,
    action: 'SMTP_UPDATE',
    entityType: 'Setting',
    // `allowInsecure` remet les identifiants SMTP et les liens d'invitation en clair sur
    // le réseau : le geste doit être daté et attribué, pas seulement effectif.
    metadata: {
      host: req.body.host ?? null,
      passwordChanged: req.body.password !== undefined,
      allowInsecure: req.body.allowInsecure ?? null,
    },
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
  if (!ok) {
    // Un envoi refusé parce que le secret stocké ne se déchiffre plus (rotation de clé)
    // ressemblait à « non configuré » : l'admin ressaisissait host et port sans rien
    // réparer. On nomme la cause, seule action utile étant de ressaisir le mot de passe.
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
