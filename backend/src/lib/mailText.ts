// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Plain-text version of an email, derived from its HTML.
 *
 * Our messages only went out as HTML. That is a fault on three counts: anti-spam filters penalise a message without
 * a text alternative, previews (mailbox list, watch notification, screen reader) then show raw markup, and a client
 * in text mode shows nothing at all.
 *
 * Rather than writing each message twice — and forgetting one — the text is derived from the already rendered HTML.
 * The conversion is deliberately modest: it does not aim to reproduce the layout, but to make the message readable
 * and its links accessible.
 */

import { escapeHtml } from './html';

/** HTML entities our templates actually produce. */
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&laquo;': '«',
  '&raquo;': '»',
  '&hellip;': '…',
  '&mdash;': '—',
  '&ndash;': '–',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => {
      const known = ENTITIES[m.toLowerCase()];
      if (known !== undefined) return known;
      const numeric = /^&#(\d+);$/.exec(m);
      return numeric ? String.fromCodePoint(Number(numeric[1])) : m;
    })
    .replace(/\u00A0/g, ' ');
}

/**
 * Internal cell-separator marker: a character from the private-use area rather than a NUL. The latter is a control
 * character, which the lint forbids in regular expressions; the former never appears in an email.
 */
const CELL_SEP = '\uE000';

/**
 * A link becomes "label (address)" — unless the label IS the address, in which case repeating it would tell nothing.
 * A button "Accept the invitation" without its address would be unusable as text: that is the point of the conversion.
 */
function inlineLinks(html: string): string {
  return html.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    // The address arrives ESCAPED from the template (`mailButton` and the fallback link now go through `escapeHtml`):
    // a query `&` is `&amp;` there. Without decoding, an address carrying a parameter was no longer recognised as
    // equal to its label, and the "address (address)" fallback repeated it twice in the text version.
    //
    // Only the COMPARISON works on the decoded form: what is reinjected stays the escaped form, which the final pass
    // of `htmlToText` decodes — once, not twice.
    const url = decodeEntities(href);
    const label = decodeEntities(inner.replace(/<[^>]+>/g, '')).trim();
    if (!label) return href;
    if (label === url) return href;
    return `${label} (${href})`;
  });
}

/** The plain text of an email, from its HTML. */
export function htmlToText(html: string): string {
  const withLinks = inlineLinks(html);
  const blocks = withLinks
    // Anything without readable text disappears entirely, content included.
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '')
    // An empty block produces no empty line: our templates use them for layout (spacers, layout cells), and the text
    // would otherwise come out randomly airy.
    .replace(/<(p|div|td|th|tr|li|h[1-4])\b[^>]*>\s*<\/\1>/gi, '')
    // A table cell counts as a separator: without it, two columns stick together.
    .replace(/<\/(td|th)>/gi, ` ${CELL_SEP} `)
    // Blocks become line breaks, and explicit breaks too.
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h1|h2|h3|h4|li|table)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '');

  return decodeEntities(blocks)
    .replace(/[ \t]*\uE000[ \t]*/g, ' \u00B7 ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, index, all) => line !== '' || (index > 0 && all[index - 1] !== ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Preview text shown in the message list, before even opening.
 *
 * Without it, clients put the first text they find there — here the studio name, repeated from one message to the
 * next. It is hidden in several ways because none works everywhere: zero height, transparency, and invisible
 * characters to push the text that follows out of the field.
 */
export function preheader(text: string): string {
  // `escapeHtml` from `lib/html`, and certainly not a local copy: the one that lived here only handled `&`, `<` and
  // `>`. The preview text is today a text node, so the truncated copy sufficed — but it is exactly the line that
  // gets duplicated the day the same data goes into an attribute, and it becomes wrong at that moment.
  const spacer = '&#847;&zwnj;&nbsp;'.repeat(60);
  return `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escapeHtml(text)}${spacer}</div>`;
}
