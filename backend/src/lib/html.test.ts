// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { escapeHtml } from './html';

/**
 * L'échappement sert dans trois contextes : un nœud de texte, un attribut entre guillemets
 * doubles, un attribut entre guillemets simples. Deux des copies historiques de cette
 * fonction n'échappaient pas le guillemet — le seul caractère qui compte dans un attribut.
 */
describe('escapeHtml', () => {
  it('échappe les six caractères qui referment un contexte HTML', () => {
    expect(escapeHtml(`&<>"'\``)).toBe('&amp;&lt;&gt;&quot;&#39;&#96;');
  });

  it('n’échappe pas deux fois l’esperluette', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('<a>')).toBe('&lt;a&gt;');
    // Le piège des `replace` enchaînés : `&lt;` deviendrait `&amp;lt;` si `&` passait après.
    expect(escapeHtml(escapeHtml('<a>'))).toBe('&amp;lt;a&amp;gt;');
  });

  it('ferme la sortie d’un attribut à guillemets doubles', () => {
    const html = `<a href="${escapeHtml('x" onload="alert(1)')}">`;
    expect(html).toBe('<a href="x&quot; onload=&quot;alert(1)">');
    expect(html).not.toContain('onload="');
  });

  it('ferme la sortie d’un attribut à guillemets simples', () => {
    const html = `<a title='${escapeHtml("x' onload='alert(1)")}'>`;
    expect(html).toContain('&#39;');
    expect(html).not.toContain("onload='");
  });

  it('laisse passer un texte sans caractère spécial', () => {
    expect(escapeHtml('Séquence SH010 — v003')).toBe('Séquence SH010 — v003');
    expect(escapeHtml('')).toBe('');
  });

  it('garde une URL lisible et exploitable', () => {
    expect(escapeHtml('https://git.studio.tld/review?a=1&b=2')).toBe(
      'https://git.studio.tld/review?a=1&amp;b=2',
    );
  });
});
