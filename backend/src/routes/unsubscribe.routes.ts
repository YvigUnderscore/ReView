// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { type Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { validate } from '../middleware/validate';
import { rateLimit } from '../middleware/rateLimit';
import { verifyUnsubscribe } from '../lib/unsubscribe';
import { logger } from '../lib/logger';

/**
 * Désabonnement des envois récurrents — route PUBLIQUE, sans session.
 *
 * C'est la contrepartie de l'en-tête `List-Unsubscribe` : le bouton natif de la
 * messagerie appelle cette adresse sans que le lecteur soit connecté, et souvent depuis
 * les serveurs du fournisseur. Le jeton signé porte donc à lui seul l'identité visée.
 *
 * Sa portée est étroite par construction : il éteint UNE préférence d'envoi. Il n'ouvre
 * aucune session, ne révèle rien du compte, et un jeton forgé ne fait rien.
 *
 * Sans ce chemin, le lecteur qui ne veut plus du digest n'a qu'un geste à sa portée :
 * marquer le message comme indésirable — ce qui abîme la réputation du serveur pour tous
 * les envois du studio, invitations comprises.
 */
const router = Router();

const tokenParam = z.object({ token: z.string().min(8).max(300) });

// Un jeton par compte et par type : le quota protège de l'essai en force sur la signature.
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });

async function unsubscribe(token: string): Promise<boolean> {
  const parsed = verifyUnsubscribe(token);
  if (!parsed) return false;
  const user = await prisma.user.findUnique({
    where: { id: parsed.userId },
    select: { preferences: true },
  });
  if (!user) return false;
  const preferences = { ...((user.preferences as Record<string, unknown> | null) ?? {}) };
  preferences[parsed.kind] = false;
  await prisma.user.update({
    where: { id: parsed.userId },
    data: { preferences: preferences as Prisma.InputJsonValue },
  });
  logger.info({ userId: parsed.userId, kind: parsed.kind }, 'Désabonnement en un clic');
  return true;
}

/**
 * Appelé par le bouton natif des messageries (`List-Unsubscribe-Post`). La réponse doit
 * être immédiate et sans page : personne ne la lit.
 */
router.post('/:token', limiter, validate({ params: tokenParam }), async (req, res) => {
  await unsubscribe(String(req.params.token));
  // Toujours 204, jeton valide ou non : distinguer les deux cas dirait à un tiers si un
  // compte existe.
  res.status(204).end();
});

/** Le même lien, suivi à la main depuis le corps du message : une page de confirmation. */
router.get('/:token', limiter, validate({ params: tokenParam }), async (req, res) => {
  const ok = await unsubscribe(String(req.params.token));
  res
    .status(ok ? 200 : 400)
    .type('html')
    .send(page(ok));
});

/**
 * Page autonome : ni React, ni session, ni catalogue de traduction. Elle est lue une fois,
 * par quelqu'un qui vient de cliquer dans un email — l'anglais, langue de base, y suffit.
 */
function page(ok: boolean): string {
  const title = ok ? 'You are unsubscribed' : 'This link is no longer valid';
  const body = ok
    ? 'You will no longer receive this recurring email. You can turn it back on at any time from your ReView profile.'
    : 'The link may have expired or been altered. Open your ReView profile to change your email preferences.';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#0B0E14;color:#E6EBEF">
<div style="max-width:520px;margin:15vh auto;padding:24px;background:#121620;border:1px solid #1E2433;border-radius:12px">
<h1 style="font-size:18px;margin:0 0 12px">${title}</h1>
<p style="font-size:14px;line-height:1.7;color:#9BA3B2;margin:0">${body}</p>
</div></body></html>`;
}

export default router;
