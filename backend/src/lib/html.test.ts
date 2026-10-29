// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { escapeHtml } from './html';

/**
 * Escaping serves three contexts: a text node, an attribute in double quotes, an attribute in single quotes. Two
 * of the historical copies of this function did not escape the quote — the only character that matters in an attribute.
 */
describe('escapeHtml', () => {
  it('escapes the six characters that close an HTML context', () => {
    expect(escapeHtml(`&<>"'\``)).toBe('&amp;&lt;&gt;&quot;&#39;&#96;');
  });

  it('does not escape the ampersand twice', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('<a>')).toBe('&lt;a&gt;');
    // The trap of chained `replace`: `&lt;` would become `&amp;lt;` if `&` came after.
    expect(escapeHtml(escapeHtml('<a>'))).toBe('&amp;lt;a&amp;gt;');
  });

  it('closes the output of an attribute in double quotes', () => {
    const html = `<a href="${escapeHtml('x" onload="alert(1)')}">`;
    expect(html).toBe('<a href="x&quot; onload=&quot;alert(1)">');
    expect(html).not.toContain('onload="');
  });

  it('closes the output of an attribute in single quotes', () => {
    const html = `<a title='${escapeHtml("x' onload='alert(1)")}'>`;
    expect(html).toContain('&#39;');
    expect(html).not.toContain("onload='");
  });

  it('lets through a text without special characters', () => {
    expect(escapeHtml('Séquence SH010 — v003')).toBe('Séquence SH010 — v003');
    expect(escapeHtml('')).toBe('');
  });

  it('keeps a readable and usable URL', () => {
    expect(escapeHtml('https://git.studio.tld/review?a=1&b=2')).toBe(
      'https://git.studio.tld/review?a=1&amp;b=2',
    );
  });
});
