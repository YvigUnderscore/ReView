// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { escapeHtml } from '../lib/html';
import { isMailerConfigured, sendMail } from '../lib/mailer';
import { mailLayout, mailButton, MAIL_ACCENT, MAIL_MUTED } from '../lib/mailTemplate';
import { displayName } from '../lib/userView';
import { badRequest, notFound } from '../lib/errors';
import { t, type Locale } from '../i18n';

/**
 * Invitation d'un nouveau membre (Phase 47) : à la création d'un compte, l'administrateur
 * peut ne pas choisir de mot de passe — la personne reçoit un lien par email et choisit
 * le sien. Un mot de passe transmis par Slack ou dicté au téléphone n'est jamais changé
 * ensuite ; l'invitation supprime cette poignée de main bancale.
 *
 * Le jeton n'est stocké que haché (SHA-256), comme un mot de passe : la base ne contient
 * aucun lien d'activation rejouable.
 */

/** Durée de validité d'un lien d'invitation. Assez long pour couvrir des congés, pas plus. */
export const INVITATION_TTL_DAYS = 7;

/**
 * Les emails d'invitation partent en anglais : le destinataire n'a pas encore de compte
 * ouvert, donc aucune préférence de langue connue, et l'anglais est la langue de référence
 * des catalogues. Les autres emails (digest, rapport hebdo) restent, eux, dans la langue
 * du destinataire, qu'on connaît.
 */
const INVITATION_LOCALE: Locale = 'en';

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** URL de la page d'activation portée par l'email. */
export function invitationUrl(token: string): string {
  return `${env.APP_URL ?? ''}/invite/${token}`;
}

/** HTML de l'email d'invitation (pur — testé unitairement). */
export function renderInvitationHtml(
  locale: Locale,
  recipientName: string,
  inviterName: string | null,
  url: string,
): string {
  const intro = inviterName
    ? t(locale, 'invite.introBy', { inviter: inviterName })
    : t(locale, 'invite.intro');
  const content = `<p>${escapeHtml(t(locale, 'invite.greeting', { name: recipientName }))}</p>
<p>${escapeHtml(intro)}</p>
${mailButton(url, t(locale, 'invite.cta'))}
<p style="color:${MAIL_MUTED};font-size:12px">${escapeHtml(t(locale, 'invite.expiry', { days: INVITATION_TTL_DAYS }))}</p>
<p style="color:${MAIL_MUTED};font-size:12px">${escapeHtml(t(locale, 'invite.fallback'))}<br />
<a href="${url}" style="color:${MAIL_ACCENT};word-break:break-all">${escapeHtml(url)}</a></p>
<p style="color:${MAIL_MUTED};font-size:12px">${escapeHtml(t(locale, 'invite.ignore'))}</p>`;
  // Le texte d'aperçu, celui que la boîte de réception affiche avant l'ouverture :
  // sans lui, elle y répète le nom du studio, identique d'un message à l'autre.
  return mailLayout(locale, t(locale, 'invite.title'), content, t(locale, 'invite.preview'));
}

/**
 * Refuse tôt ce qui ne pourra pas aboutir. Appelé avant de créer le compte : mieux vaut
 * un message d'erreur que le compte d'un collègue qui n'a jamais reçu son lien.
 */
export async function assertCanInvite(): Promise<void> {
  if (!env.APP_URL) {
    throw badRequest(
      "APP_URL n'est pas configuré : le lien d'invitation serait inutilisable",
      'APP_URL_MISSING',
    );
  }
  if (!(await isMailerConfigured())) {
    throw badRequest('SMTP is not configured — an invitation cannot be sent', 'SMTP_NOT_CONFIGURED');
  }
}

/**
 * Émet un jeton d'invitation pour un compte existant et envoie l'email.
 * Toute invitation encore pendante pour ce compte est supprimée au passage : relancer une
 * invitation doit périmer le lien précédent, sinon un lien oublié dans une boîte mail
 * reste une porte ouverte.
 */
export async function sendInvitation(userId: number, invitedById: number | null): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      firstName: true,
      lastName: true,
      username: true,
      isService: true,
    },
  });
  if (!user) throw notFound('User not found');
  // Un compte de service porte une adresse non routable : rien à inviter.
  if (user.isService) throw badRequest('A service account cannot be invited', 'SERVICE_ACCOUNT');
  await assertCanInvite();

  const token = randomBytes(32).toString('base64url');
  await prisma.$transaction([
    prisma.invitation.deleteMany({ where: { userId, acceptedAt: null } }),
    prisma.invitation.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
        invitedById,
      },
    }),
  ]);

  const inviter = invitedById
    ? await prisma.user.findUnique({
        where: { id: invitedById },
        select: { id: true, email: true, name: true, firstName: true, lastName: true, username: true },
      })
    : null;
  const html = renderInvitationHtml(
    INVITATION_LOCALE,
    displayName(user),
    inviter ? displayName(inviter) : null,
    invitationUrl(token),
  );
  const sent = await sendMail(user.email, t(INVITATION_LOCALE, 'invite.subject'), html);
  if (!sent) {
    // L'invitation reste en base : l'administrateur peut relancer une fois le relais réparé,
    // sans avoir à supprimer puis recréer le compte.
    logger.error({ userId }, '[Invitation] envoi impossible');
    throw badRequest('Could not send (SMTP error)', 'SMTP_SEND_FAILED');
  }
  logger.info({ userId }, '[Invitation] envoyée');
}

export interface InvitationView {
  email: string;
  name: string;
  invitedBy: string | null;
}

/** Invitation valide (non acceptée, non expirée) portée par ce jeton, sinon `null`. */
async function findValid(token: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      userId: true,
      acceptedAt: true,
      expiresAt: true,
      user: {
        select: { id: true, email: true, name: true, firstName: true, lastName: true, username: true },
      },
      invitedBy: {
        select: { id: true, email: true, name: true, firstName: true, lastName: true, username: true },
      },
    },
  });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) return null;
  return invitation;
}

/**
 * Aperçu affiché sur la page d'activation. Le jeton est le seul secret : on ne révèle que
 * ce que son porteur sait déjà (sa propre adresse), pas l'annuaire du studio.
 */
export async function describeInvitation(token: string): Promise<InvitationView> {
  const invitation = await findValid(token);
  if (!invitation) throw badRequest('Invalid or expired invitation', 'INVITATION_INVALID');
  return {
    email: invitation.user.email,
    name: displayName(invitation.user),
    invitedBy: invitation.invitedBy ? displayName(invitation.invitedBy) : null,
  };
}

/** Consomme le jeton et pose le mot de passe choisi. Renvoie le compte activé. */
export async function acceptInvitation(token: string, password: string) {
  const invitation = await findValid(token);
  if (!invitation) throw badRequest('Invalid or expired invitation', 'INVITATION_INVALID');
  const hash = await bcrypt.hash(password, 12);
  // `updateMany` sur `acceptedAt: null` : deux soumissions concurrentes du même lien ne
  // doivent poser qu'un seul mot de passe.
  const consumed = await prisma.invitation.updateMany({
    where: { id: invitation.id, acceptedAt: null },
    data: { acceptedAt: new Date() },
  });
  if (consumed.count === 0) throw badRequest('Invalid or expired invitation', 'INVITATION_INVALID');
  return prisma.user.update({
    where: { id: invitation.userId },
    data: { password: hash },
  });
}
