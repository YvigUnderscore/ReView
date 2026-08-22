// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ShareScope } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { isMailerConfigured, sendMail } from '../lib/mailer';
import { mailLayout, mailButton, MAIL_ACCENT, MAIL_MUTED } from '../lib/mailTemplate';
import { displayName } from '../lib/userView';
import { logAudit } from './AuditService';
import { badRequest, notFound } from '../lib/errors';
import { t, type Locale } from '../i18n';

/**
 * Envoi du lien de partage par courriel, depuis l'onglet Partages.
 *
 * Le lien était créé puis copié dans le presse-papier : à charge du superviseur de le
 * coller quelque part, sans mention de sa date d'expiration ni de sa limite de vues. Le
 * client recevait donc une URL nue dans un fil de discussion, et découvrait la péremption
 * en cliquant dessus.
 *
 * L'email part en anglais, comme les invitations : le destinataire n'a pas de compte, donc
 * aucune préférence de langue connue, et l'anglais est la langue de référence des
 * catalogues.
 */
const SHARE_MAIL_LOCALE: Locale = 'en';

/** Un envoi ne s'adresse pas à une liste de diffusion : au-delà, c'est une newsletter. */
export const SHARE_MAIL_MAX_RECIPIENTS = 10;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** URL publique du lien, telle qu'elle est ouverte dans un navigateur. */
export function shareUrl(token: string): string {
  return `${env.APP_URL ?? ''}/client/${token}`;
}

export interface ShareMailContext {
  projectName: string;
  senderName: string;
  /** Ce que le lien ouvre, déjà résolu en nom lisible (playlist, version) le cas échéant. */
  scope: ShareScope;
  scopeTarget: string | null;
  expiresAt: Date | null;
  maxViews: number | null;
  hasPassword: boolean;
  note: string | null;
  url: string;
}

/** Phrase qui dit au destinataire ce qu'il va voir — la portée n'est utile que si elle se lit. */
export function scopeLine(locale: Locale, ctx: Pick<ShareMailContext, 'scope' | 'scopeTarget'>): string {
  const target = ctx.scopeTarget ?? '';
  switch (ctx.scope) {
    case ShareScope.PLAYLIST:
      return t(locale, 'share.mail.scope.playlist', { name: target });
    case ShareScope.VERSION:
      return t(locale, 'share.mail.scope.version', { name: target });
    case ShareScope.MEDIA:
      return t(locale, 'share.mail.scope.selection');
    case ShareScope.PROJECT:
    default:
      return t(locale, 'share.mail.scope.project');
  }
}

/** HTML de l'email de partage (pur — testé unitairement). */
export function renderShareMailHtml(locale: Locale, ctx: ShareMailContext): string {
  const date = ctx.expiresAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(ctx.expiresAt)
    : null;
  const small = `color:${MAIL_MUTED};font-size:12px`;
  const lines = [
    date ? t(locale, 'share.mail.expiry', { date }) : t(locale, 'share.mail.noExpiry'),
    ctx.maxViews != null ? t(locale, 'share.mail.viewLimit', { count: ctx.maxViews }) : null,
    ctx.hasPassword ? t(locale, 'share.mail.password') : null,
  ].filter((l): l is string => l !== null);

  const content = `<p>${esc(t(locale, 'share.mail.intro', { sender: ctx.senderName, project: ctx.projectName }))}</p>
<p>${esc(scopeLine(locale, ctx))}</p>
${ctx.note ? `<p style="border-left:2px solid ${MAIL_ACCENT};padding-left:12px">${esc(ctx.note)}</p>` : ''}
${mailButton(ctx.url, t(locale, 'share.mail.cta'))}
<p style="${small}">${lines.map(esc).join('<br />')}</p>
<p style="${small}">${esc(t(locale, 'share.mail.fallback'))}<br />
<a href="${ctx.url}" style="color:${MAIL_ACCENT};word-break:break-all">${esc(ctx.url)}</a></p>`;

  return mailLayout(
    locale,
    t(locale, 'share.mail.title', { project: ctx.projectName }),
    content,
    t(locale, 'share.mail.preview'),
  );
}

/**
 * Envoie le lien à un ou plusieurs destinataires. Refuse tôt ce qui ne peut pas aboutir
 * (pas d'URL publique, pas de relais SMTP, lien révoqué) : mieux vaut un message d'erreur
 * qu'un client qui attend un email jamais parti.
 */
export async function sendShareMail(
  senderId: number,
  linkId: number,
  recipients: string[],
  note: string | null,
): Promise<{ sent: number }> {
  if (!env.APP_URL)
    throw badRequest('APP_URL is not configured — the link would be unusable', 'APP_URL_MISSING');
  if (!(await isMailerConfigured()))
    throw badRequest('SMTP is not configured — the link cannot be emailed', 'SMTP_NOT_CONFIGURED');

  const link = await prisma.shareLink.findUnique({
    where: { id: linkId },
    select: {
      id: true,
      token: true,
      projectId: true,
      revoked: true,
      expiresAt: true,
      maxViews: true,
      passwordHash: true,
      scope: true,
      project: { select: { name: true } },
      playlist: { select: { name: true } },
      version: { select: { name: true } },
    },
  });
  if (!link) throw notFound('Link not found');
  if (link.revoked) throw badRequest('This link has been revoked', 'SHARE_REVOKED');

  const sender = await prisma.user.findUnique({
    where: { id: senderId },
    select: { id: true, email: true, name: true, firstName: true, lastName: true, username: true },
  });
  const html = renderShareMailHtml(SHARE_MAIL_LOCALE, {
    projectName: link.project.name,
    senderName: sender ? displayName(sender) : link.project.name,
    scope: link.scope,
    scopeTarget: link.playlist?.name ?? link.version?.name ?? null,
    expiresAt: link.expiresAt,
    maxViews: link.maxViews,
    hasPassword: link.passwordHash != null,
    note,
    url: shareUrl(link.token),
  });
  const subject = t(SHARE_MAIL_LOCALE, 'share.mail.subject', { project: link.project.name });

  // Un destinataire par message : une liste en clair dans `To:` révèle à chaque client
  // l'adresse des autres — et le partage sert souvent à montrer la même chose à des
  // interlocuteurs qui ne doivent pas savoir qu'ils sont plusieurs.
  const results = await Promise.all(recipients.map((to) => sendMail(to, subject, html)));
  const sent = results.filter(Boolean).length;
  logAudit({
    userId: senderId,
    action: 'SHARE_EMAIL',
    entityType: 'Project',
    entityId: link.projectId,
    metadata: { shareLinkId: link.id, recipients: recipients.length, sent },
  });
  if (sent === 0) {
    logger.error({ linkId }, '[Share] envoi impossible');
    throw badRequest('Could not send (SMTP error)', 'SMTP_SEND_FAILED');
  }
  return { sent };
}
