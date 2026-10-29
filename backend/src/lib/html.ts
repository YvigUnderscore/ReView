// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * HTML escaping, for the little HTML the server produces itself: emails, the API documentation page, the
 * unsubscribe page.
 *
 * A copy of this function lay around in every mail service. Three copies mean three chances to forget one —
 * usually the quote, which is precisely the one that matters inside an attribute.
 */

/**
 * Contract: the output is safe inside a text node **and** inside an attribute, whether quoted with double or
 * single quotes. The six characters are handled in a single pass (a chain of `replace` reintroduces the risk of
 * getting the order of `&` wrong): `&` `<` `>` `"` `'` and the backtick, which old engines treat as an attribute
 * delimiter. `=` and `/` are not escaped: they only matter in an unquoted attribute — a case we never write — and
 * making them unreadable would damage URLs.
 */

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

export const escapeHtml = (value: string): string => value.replace(/[&<>"'`]/g, (c) => ESCAPES[c]!);
