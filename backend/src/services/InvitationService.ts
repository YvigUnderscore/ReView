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
 * Invitation of a new member (Phase 47): when an account is created, the administrator may choose not to set
 * a password — the person receives a link by email and picks their own.
 * A password passed on via Slack or dictated over the phone is never changed afterwards; the invitation
 * removes that shaky handshake.
 *
 * The token is only stored hashed (SHA-256), like a password: the database holds no replayable activation
 * link.
 */

/** Validity period of an invitation link. Long enough to cover holidays, no longer. */
export const INVITATION_TTL_DAYS = 7;

/**
 * The invitation emails go out in English: the recipient does not yet have an open account, so no language
 * preference is known, and English is the reference language of the catalogues. The other emails (digest,
 * weekly report), for their part, remain in the recipient's language, which is known.
 */
const INVITATION_LOCALE: Locale = 'en';

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** URL of the activation page carried by the email. */
export function invitationUrl(token: string): string {
  return `${env.APP_URL ?? ''}/invite/${token}`;
}

/**
 * HTML of the invitation email (pure — unit tested).
 *
 * `url` goes through `escapeHtml` TWICE: in the `href` attribute of the fallback link as well as in its text.
 * Today it is `APP_URL` + a hexadecimal token, so nothing in it gets escaped — but `APP_URL` is an
 * environment variable, and the day it carries a quotation mark the attribute closes and the rest of the line
 * becomes markup. This is the fault already corrected in `ShareMailService`: leaving it written here would
 * bring it back at the first copy-paste.
 */
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
<a href="${escapeHtml(url)}" style="color:${MAIL_ACCENT};word-break:break-all">${escapeHtml(url)}</a></p>
<p style="color:${MAIL_MUTED};font-size:12px">${escapeHtml(t(locale, 'invite.ignore'))}</p>`;
  // The preview text, the one the inbox shows before opening: without it, the inbox repeats the studio name,
  // identical from one message to the next.
  return mailLayout(locale, t(locale, 'invite.title'), content, t(locale, 'invite.preview'));
}

/**
 * Refuses early what cannot succeed. Called before creating the account: better an error message than a
 * colleague's account that never received its link.
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
 * Issues an invitation token for an existing account and sends the email. Any invitation still pending for
 * this account is deleted in passing: sending a new invitation must expire the previous link, otherwise a
 * link forgotten in a mailbox remains an open door.
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
  // A service account carries a non-routable address: nothing to invite.
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
    // The invitation remains in the database: the administrator can resend once the relay is repaired,
    // without having to delete then recreate the account.
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

/** Valid invitation (not accepted, not expired) carried by this token, otherwise `null`. */
async function findValid(token: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      userId: true,
      acceptedAt: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          firstName: true,
          lastName: true,
          username: true,
          disabledAt: true,
        },
      },
      invitedBy: {
        select: { id: true, email: true, name: true, firstName: true, lastName: true, username: true },
      },
    },
  });
  // Offboarding (A1-01): an invitation link still in a mailbox at the time of departure opened a session
  // right after — it set a password AND logged in. An account that is disabled no longer has a valid
  // invitation: the preview and the activation both treat it as an expired link, without saying why (the
  // bearer of the link has no need to learn the state of an account).
  if (
    !invitation ||
    invitation.acceptedAt ||
    invitation.expiresAt < new Date() ||
    invitation.user.disabledAt
  ) {
    return null;
  }
  return invitation;
}

/**
 * Preview displayed on the activation page. The token is the only secret: we reveal only what its bearer
 * already knows (their own address), not the studio's directory.
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

/** Consumes the token and sets the chosen password. Returns the activated account. */
export async function acceptInvitation(token: string, password: string) {
  const invitation = await findValid(token);
  if (!invitation) throw badRequest('Invalid or expired invitation', 'INVITATION_INVALID');
  const hash = await bcrypt.hash(password, 12);
  // `updateMany` on `acceptedAt: null`: two concurrent submissions of the same link must set only one
  // password.
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
