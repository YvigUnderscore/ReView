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
import { localeFromAcceptLanguage, t, type Locale } from '../i18n';
import { escapeHtml } from '../lib/html';

/**
 * Unsubscribing from recurring mailings: a PUBLIC route, without session.
 *
 * It is the counterpart of the `List-Unsubscribe` header: the mail client's native button calls this address
 * without the reader being logged in, and often from the provider's servers. The signed token therefore
 * carries on its own the targeted identity.
 *
 * Its scope is narrow by construction: it switches off ONE sending preference. It opens no session, reveals
 * nothing of the account, and a forged token does nothing.
 *
 * Without this path, the reader who no longer wants the digest has only one gesture within reach: marking the
 * message as spam, which damages the server's reputation for all of the studio's mailings, invitations included.
 *
 * ⚠ Three routes, and the sharing of roles among them is not decorative: the GET MUST change nothing.
 * Antivirus gateways and mail proxies (SafeLinks and the like) preload the links of messages: a GET that
 * unsubscribes unsubscribes by itself, without anyone having clicked. The link received by email therefore
 * remains valid, but only shows a confirmation request.
 */
const router = Router();

const tokenParam = z.object({ token: z.string().min(8).max(300) });

// One token per account and per type: the quota protects against brute-force attempts on the signature.
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
  logger.info({ userId: parsed.userId, kind: parsed.kind }, 'One-click unsubscribe');
  return true;
}

/**
 * Human confirmation: the target of the page's button, served by the GET.
 *
 * Declared before `POST /:token`, otherwise the word "confirm" would be read as a token.
 */
router.post('/:token/confirm', limiter, validate({ params: tokenParam }), async (req, res) => {
  const ok = await unsubscribe(String(req.params.token));
  res
    .status(ok ? 200 : 400)
    .type('html')
    .send(
      page(
        ok ? 'done' : 'invalid',
        '',
        await getSourceUrl(),
        localeFromAcceptLanguage(req.headers['accept-language']),
      ),
    );
});

/**
 * Called by the mail clients' native button (`List-Unsubscribe-Post`). The response must be immediate and
 * without a page: nobody reads it.
 */
router.post('/:token', limiter, validate({ params: tokenParam }), async (req, res) => {
  await unsubscribe(String(req.params.token));
  // Always 204, valid token or not: distinguishing the two cases would tell a third party whether an account exists.
  res.status(204).end();
});

/**
 * The same link, followed by hand from the body of the message: a confirmation page.
 * No write here: see the warning at the top of the file.
 */
router.get('/:token', limiter, validate({ params: tokenParam }), async (req, res) => {
  const token = String(req.params.token);
  const valid = verifyUnsubscribe(token) !== null;
  res
    .status(valid ? 200 : 400)
    .type('html')
    .send(
      page(
        valid ? 'confirm' : 'invalid',
        token,
        await getSourceUrl(),
        localeFromAcceptLanguage(req.headers['accept-language']),
      ),
    );
});

/**
 * Standalone page: neither React nor session, but translated nonetheless.
 *
 * It was only in English, on the grounds that no catalogue was available server-side. There is one, and this
 * page is precisely the one an external recipient opens after clicking in an email: it is the surface where
 * their language matters most, and the only one the application cannot let them choose. The language is
 * therefore negotiated on `Accept-Language`, as for the public page `/api/docs`.
 */
function page(
  state: 'confirm' | 'done' | 'invalid',
  token: string,
  sourceUrl: string,
  locale: Locale,
): string {
  const copy = {
    confirm: {
      title: t(locale, 'unsubscribe.confirm.title'),
      body: t(locale, 'unsubscribe.confirm.body'),
    },
    done: { title: t(locale, 'unsubscribe.done.title'), body: t(locale, 'unsubscribe.done.body') },
    invalid: {
      title: t(locale, 'unsubscribe.invalid.title'),
      body: t(locale, 'unsubscribe.invalid.body'),
    },
  }[state];
  // The button POSTs: that is what puts the action out of reach of a link preload.
  const form =
    state === 'confirm'
      ? `<form method="post" action="/api/unsubscribe/${escapeHtml(encodeURIComponent(token))}/confirm" style="margin:20px 0 0">
<button type="submit" style="font:inherit;font-size:14px;padding:10px 16px;border-radius:8px;border:1px solid #1E2433;background:#1B2233;color:#E6EBEF;cursor:pointer">${escapeHtml(t(locale, 'unsubscribe.action'))}</button>
</form>`
      : '';
  return `<!doctype html>
<html lang="${escapeHtml(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(copy.title)}</title></head>
<body style="margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#0B0E14;color:#E6EBEF">
<div style="max-width:520px;margin:15vh auto;padding:24px;background:#121620;border:1px solid #1E2433;border-radius:12px">
<h1 style="font-size:18px;margin:0 0 12px">${escapeHtml(copy.title)}</h1>
<p style="font-size:14px;line-height:1.7;color:#9BA3B2;margin:0">${escapeHtml(copy.body)}</p>
${form}
<!-- AGPL §13 : une surface accessible sans authentification porte le lien vers le code
     source correspondant. Cette page en est une. -->
<p style="margin:20px 0 0;font-size:12px;color:#6B7280">
ReView — AGPL-3.0. <a href="${escapeHtml(sourceUrl)}" style="color:#9BA3B2">Source code</a>
</p>
</div></body></html>`;
}

export default router;
