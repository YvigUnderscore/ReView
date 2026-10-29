// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { env } from '../config/env';
import { t, type Locale } from '../i18n';
import { escapeHtml } from './html';
import { preheader } from './mailText';

/**
 * Brand HTML wrapper shared by all ReView emails (Phase 22) — consistent look (midnight blue theme, cyan accent).
 * Mail clients do not support CSS variables, so the theme colours are hard-coded here: they now reproduce exactly
 * the reference palette of dark mode (`frontend/src/index.css`), rather than the Tailwind approximations that gave
 * our mails the look of another application. The former cyan-to-magenta gradient banner is removed: a flat brand
 * colour, a logo.
 */

/** Brand accent (cyan `--primary` of dark mode) — links and buttons. */
export const MAIL_ACCENT = '#00F0FF';
/** Rules and internal separators of the message body (`--border`). */
export const MAIL_BORDER = '#1E2433';
/** Secondary body text (`--muted-foreground`) — never an arbitrary grey. */
export const MAIL_MUTED = '#9BA3B2';

const BG = '#0B0E14'; // --background
const CARD = '#121620'; // --card
const BORDER = MAIL_BORDER;
const TEXT = '#E6EBEF'; // --foreground
const MUTED = MAIL_MUTED;
const TITLE = '#F4F7F9';

/**
 * Header: the site logo when the instance has a public URL (remote images cannot be served from a relative path in an
 * email), otherwise the name spelled out. `alt` carries the brand anyway — many clients block images.
 */
function brandHeader(): string {
  const logo = env.APP_URL ? `${env.APP_URL}/logo_banner.png` : null;
  return logo
    ? `<img src="${escapeHtml(logo)}" alt="ReView" width="112" style="display:block;border:0;height:auto;width:112px" />`
    : `<span style="font-weight:500;color:${TEXT};font-size:16px;letter-spacing:0.06em">ReView</span>`;
}

/**
 * Main action button. Mail clients ignore `<button>` and most stylesheets: it is a full-background link, entirely
 * inline-styled.
 *
 * `url` and `label` are DATA, not markup: the address carries tokens, the label comes from a translation catalogue.
 * Escaping them costs the ampersand of a URL rendered as `&amp;` — which is precisely the correct form in an attribute.
 */
export function mailButton(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px auto"><tr><td align="center" bgcolor="${MAIL_ACCENT}" style="background:${MAIL_ACCENT};border-radius:8px">
<a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 28px;color:${BG};font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;font-weight:600;text-decoration:none">${escapeHtml(label)}</a>
</td></tr></table>`;
}

/**
 * Wraps HTML content in the brand wrapper (logo header + footer).
 *
 * The footer is translated into the recipient's language — an email that opens in one language and signs off in
 * another sounds wrong.
 *
 * The layout is a `<table>`, not a `<div>`: Outlook for Windows renders HTML with Word's engine, which ignores
 * `border-radius`, handles `padding` badly on a block and does not know `max-width`. Our messages arrived there
 * spread across the full width, without a frame. The `preheader` is inserted at the head of the body: it is the text
 * the message list shows before opening, and without it the list repeats the studio name.
 *
 * Only `contentHtml` is HTML — its name says so. `title` is DATA: a caller puts a project name in it, which the first
 * supervisor who comes along can rename to a link pointing to a third-party domain, under the studio's styling and
 * from its SMTP relay. It is therefore escaped here, the only place that sees all titles go by.
 */
export function mailLayout(locale: Locale, title: string, contentHtml: string, preview?: string): string {
  return `<div lang="${locale}" style="font-family:ui-sans-serif,system-ui,sans-serif;background:${BG};padding:24px">
${preview ? preheader(preview) : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG}">
    <tr>
      <td align="center" style="padding:0">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:${CARD};border:1px solid ${BORDER};border-radius:12px;color:${TEXT}">
          <tr>
            <td style="padding:16px 20px;border-bottom:1px solid ${BORDER}">
              ${brandHeader()}
            </td>
          </tr>
          <tr>
            <td style="padding:20px;font-size:14px;line-height:1.7;color:${TEXT}">
              <h1 style="font-size:18px;font-weight:600;margin:0 0 12px;color:${TITLE}">${escapeHtml(title)}</h1>
              ${contentHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:12px 20px;border-top:1px solid ${BORDER};color:${MUTED};font-size:12px">
              ${t(locale, 'mail.footer')}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`;
}
