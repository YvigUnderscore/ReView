// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ShareScope } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { isMailerConfigured, sendMail } from '../lib/mailer';
import { mailLayout, mailButton, MAIL_ACCENT, MAIL_MUTED } from '../lib/mailTemplate';
// A single, shared escaping: the local copy forgot quotes, which is the one that matters
// in an attribute, so the one whose absence is costly.
import { escapeHtml as esc } from '../lib/html';
import { displayName } from '../lib/userView';
import { logAudit } from './AuditService';
import { badRequest, notFound } from '../lib/errors';
import { t, type Locale } from '../i18n';

/**
 * Sends the share link by email, from the Shares tab.
 *
 * The link used to be created and then copied to the clipboard: it was up to the supervisor to paste it
 * somewhere, without mention of its expiry date or its view limit. The client therefore received a bare
 * URL in a discussion thread, and discovered the expiry by clicking it.
 *
 * The email goes out in English, like the invitations: the recipient has no account, so no language
 * preference is known, and English is the reference language of the catalogs.
 */
const SHARE_MAIL_LOCALE: Locale = 'en';

/** A send is not meant for a mailing list: beyond this it is a newsletter. */
export const SHARE_MAIL_MAX_RECIPIENTS = 10;

/** Public URL of the link, as it is opened in a browser. */
export function shareUrl(token: string): string {
  return `${env.APP_URL ?? ''}/client/${token}`;
}

export interface ShareMailContext {
  projectName: string;
  senderName: string;
  /** What the link opens, already resolved to a readable name (playlist, version) where applicable. */
  scope: ShareScope;
  scopeTarget: string | null;
  expiresAt: Date | null;
  maxViews: number | null;
  hasPassword: boolean;
  note: string | null;
  url: string;
}

/** Sentence telling the recipient what they will see: the scope is only useful if it can be read. */
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

/** HTML of the share email (pure: unit-tested). */
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
<a href="${esc(ctx.url)}" style="color:${MAIL_ACCENT};word-break:break-all">${esc(ctx.url)}</a></p>`;

  return mailLayout(
    locale,
    t(locale, 'share.mail.title', { project: ctx.projectName }),
    content,
    t(locale, 'share.mail.preview'),
  );
}

/**
 * Sends the link to one or more recipients. Rejects early what cannot succeed (no public URL, no SMTP relay,
 * revoked link): better an error message than a client waiting for an email that was never sent.
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

  // One recipient per message: a plain list in `To:` reveals every other recipient's address to each
  // client, and sharing often shows the same thing to people who must not know they are several.
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
    logger.error({ linkId }, '[Share] send failed');
    throw badRequest('Could not send (SMTP error)', 'SMTP_SEND_FAILED');
  }
  return { sent };
}
