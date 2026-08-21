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
import { getSourceUrl } from '../lib/settings';
import { escapeHtml } from '../lib/html';

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
 *
 * ⚠ Trois routes, et le partage des rôles entre elles n'est pas décoratif :
 * le GET ne DOIT rien modifier. Les passerelles antivirus et les proxys de messagerie
 * (SafeLinks et assimilés) préchargent les liens des messages : un GET qui désabonne
 * désabonne tout seul, sans que personne n'ait cliqué. Le lien reçu par mail reste donc
 * valide, mais il n'affiche qu'une demande de confirmation.
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
 * Confirmation humaine : la cible du bouton de la page servie par le GET.
 *
 * Déclarée avant `POST /:token` — sinon le mot « confirm » serait lu comme un jeton.
 */
router.post('/:token/confirm', limiter, validate({ params: tokenParam }), async (req, res) => {
  const ok = await unsubscribe(String(req.params.token));
  res
    .status(ok ? 200 : 400)
    .type('html')
    .send(page(ok ? 'done' : 'invalid', '', await getSourceUrl()));
});

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

/**
 * Le même lien, suivi à la main depuis le corps du message : une page de confirmation.
 * Aucune écriture ici — voir l'avertissement en tête de fichier.
 */
router.get('/:token', limiter, validate({ params: tokenParam }), async (req, res) => {
  const token = String(req.params.token);
  const valid = verifyUnsubscribe(token) !== null;
  res
    .status(valid ? 200 : 400)
    .type('html')
    .send(page(valid ? 'confirm' : 'invalid', token, await getSourceUrl()));
});

/**
 * Page autonome : ni React, ni session, ni catalogue de traduction. Elle est lue une fois,
 * par quelqu'un qui vient de cliquer dans un email — l'anglais, langue de base, y suffit.
 */
function page(state: 'confirm' | 'done' | 'invalid', token: string, sourceUrl: string): string {
  const copy = {
    confirm: {
      title: 'Confirm your unsubscribe',
      body: 'Confirm below to stop receiving this recurring email. You can turn it back on at any time from your ReView profile.',
    },
    done: {
      title: 'You are unsubscribed',
      body: 'You will no longer receive this recurring email. You can turn it back on at any time from your ReView profile.',
    },
    invalid: {
      title: 'This link is no longer valid',
      body: 'The link may have expired or been altered. Open your ReView profile to change your email preferences.',
    },
  }[state];
  // Le bouton POSTe : c'est ce qui met l'action hors de portée d'un préchargement de lien.
  const form =
    state === 'confirm'
      ? `<form method="post" action="/api/unsubscribe/${escapeHtml(encodeURIComponent(token))}/confirm" style="margin:20px 0 0">
<button type="submit" style="font:inherit;font-size:14px;padding:10px 16px;border-radius:8px;border:1px solid #1E2433;background:#1B2233;color:#E6EBEF;cursor:pointer">Unsubscribe</button>
</form>`
      : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${copy.title}</title></head>
<body style="margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#0B0E14;color:#E6EBEF">
<div style="max-width:520px;margin:15vh auto;padding:24px;background:#121620;border:1px solid #1E2433;border-radius:12px">
<h1 style="font-size:18px;margin:0 0 12px">${copy.title}</h1>
<p style="font-size:14px;line-height:1.7;color:#9BA3B2;margin:0">${copy.body}</p>
${form}
<!-- AGPL §13 : une surface accessible sans authentification porte le lien vers le code
     source correspondant. Cette page en est une. -->
<p style="margin:20px 0 0;font-size:12px;color:#6B7280">
ReView — AGPL-3.0. <a href="${escapeHtml(sourceUrl)}" style="color:#9BA3B2">Source code</a>
</p>
</div></body></html>`;
}

export default router;
