// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { htmlToText, preheader } from './mailText';

describe('htmlToText', () => {
  it('renders the text of a paragraph, without tags', () => {
    expect(htmlToText('<p>Bonjour <strong>Ada</strong>.</p>')).toBe('Bonjour Ada.');
  });

  it('keeps the address of a link next to its label', () => {
    // That is the whole point: a button "Accept the invitation" without its address is unusable as plain text.
    expect(htmlToText('<a href="https://review.test/invite/abc">Accepter l’invitation</a>')).toBe(
      'Accepter l’invitation (https://review.test/invite/abc)',
    );
  });

  it('does not repeat the address when the label already is the address', () => {
    expect(htmlToText('<a href="https://review.test">https://review.test</a>')).toBe('https://review.test');
  });

  it('does not repeat either an address with parameters, whose template escapes the "&"', () => {
    // Templates now escape the address (`mailButton`, fallback link): the attribute holds `&amp;` where the
    // label is decoded before comparison. Without decoding the attribute, the two stopped being "equal", and the
    // fallback printed the address twice in a row in the text alternative.
    const html = '<a href="https://review.test/s?t=1&amp;v=2">https://review.test/s?t=1&amp;v=2</a>';
    expect(htmlToText(html)).toBe('https://review.test/s?t=1&v=2');
  });

  it('decodes the escaped address of a button, next to its label', () => {
    const html = '<a href="https://review.test/s?t=1&amp;v=2">Open the review</a>';
    expect(htmlToText(html)).toBe('Open the review (https://review.test/s?t=1&v=2)');
  });

  it('renders a lone address when the link has no label', () => {
    expect(htmlToText('<a href="https://review.test"><img src="x"></a>')).toBe('https://review.test');
  });

  it('separates lines of blocks and explicit breaks', () => {
    expect(htmlToText('<p>Un</p><p>Deux</p>')).toBe('Un\nDeux');
    expect(htmlToText('Un<br>Deux')).toBe('Un\nDeux');
  });

  it('marks list items with a dash', () => {
    expect(htmlToText('<ul><li>Un</li><li>Deux</li></ul>')).toBe('- Un\n- Deux');
  });

  it('separates the cells of a table rather than gluing them', () => {
    // Without a separator, "SH010" and "comp" would become "SH010comp".
    expect(htmlToText('<tr><td>SH010</td><td>comp</td></tr>')).toContain('SH010');
    expect(htmlToText('<tr><td>SH010</td><td>comp</td></tr>')).not.toContain('SH010comp');
  });

  it('decodes the entities our templates produce', () => {
    expect(htmlToText('<p>Version &laquo; v003 &raquo; &mdash; 30&nbsp;%</p>')).toBe(
      'Version « v003 » — 30 %',
    );
    expect(htmlToText('<p>Rock &amp; Roll &lt;3</p>')).toBe('Rock & Roll <3');
  });

  it('drops what has no readable text, content included', () => {
    expect(htmlToText('<style>p{color:red}</style><p>Visible</p>')).toBe('Visible');
    expect(htmlToText('<script>alert(1)</script><p>Visible</p>')).toBe('Visible');
  });

  it('does not stack empty lines', () => {
    expect(htmlToText('<p>Un</p><div></div><div></div><p>Deux</p>')).toBe('Un\nDeux');
  });

  it('renders an empty string for HTML without text', () => {
    expect(htmlToText('<div><img src="x" /></div>')).toBe('');
  });
});

describe('preheader', () => {
  it('stays invisible: zero height, zero opacity, hidden from Outlook', () => {
    const html = preheader('Trois plans attendent votre review');
    expect(html).toContain('max-height:0');
    expect(html).toContain('opacity:0');
    expect(html).toContain('mso-hide:all');
  });

  it('carries the preview text', () => {
    expect(preheader('Trois plans')).toContain('Trois plans');
  });

  it('escapes the HTML: a project name does not open a tag', () => {
    expect(preheader('<script>alert(1)</script>')).not.toContain('<script>');
    expect(preheader('Rock & Roll')).toContain('Rock &amp; Roll');
  });

  it('ALSO escapes the quotes — full escaping, not the truncated copy', () => {
    // The preview text is a text node: quotes are not exploitable there today. That is exactly why a three-character
    // copy could survive here — and it is that copy which gets duplicated the day the data goes into an attribute.
    // The guard therefore checks the contract of `lib/html`: the six characters, always.
    expect(preheader('Projet "Dune" — l’épisode')).toContain('&quot;Dune&quot;');
    expect(preheader("L'épisode")).toContain('&#39;');
  });

  it('pushes the text that would follow out of the field', () => {
    // Without this padding, the client fills the preview with the start of the body — here the studio name,
    // identical from one message to the next.
    expect(preheader('Court').length).toBeGreaterThan(500);
  });
});
