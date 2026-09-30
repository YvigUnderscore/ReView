// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { renderDocHtml, isUnsafeHref, isUnsafeSrc, type CalloutLabels } from './docsRender';

const LABELS: CalloutLabels = {
  note: 'Note',
  tip: 'Astuce',
  important: 'Important',
  warning: 'Avertissement',
  caution: 'Attention',
};
const render = (markdown: string, path: string) => renderDocHtml(markdown, path, LABELS);

/**
 * Le HTML brut du markdown est échappé par le renderer, mais pas les URLs que marked
 * construit lui-même : `[clic](javascript:…)` produisait un href exécutable sur l'origine
 * de l'application — là où vit le jeton de session.
 */
describe('isUnsafeHref', () => {
  it('repère les protocoles exécutables', () => {
    for (const u of ['javascript:alert(1)', 'JavaScript:alert(1)', 'vbscript:msgbox', 'data:text/html,x'])
      expect(isUnsafeHref(u), u).toBe(true);
  });

  it('n’est pas dupe des espaces et caractères de contrôle intercalés', () => {
    for (const u of ['java\tscript:alert(1)', ' javascript:alert(1)', 'java\nscript:alert(1)'])
      expect(isUnsafeHref(u), JSON.stringify(u)).toBe(true);
  });

  it('laisse passer les liens normaux', () => {
    for (const u of ['https://exemple.com', '/docs/x.md', '#ancre', 'mailto:a@b.c'])
      expect(isUnsafeHref(u), u).toBe(false);
  });

  it('tolère data:image dans une image, pas dans un lien', () => {
    expect(isUnsafeSrc('data:image/png;base64,AAA')).toBe(false);
    expect(isUnsafeHref('data:image/png;base64,AAA')).toBe(true);
    expect(isUnsafeSrc('javascript:alert(1)')).toBe(true);
  });
});

describe('renderDocHtml', () => {
  it('retire un href javascript: produit par le markdown', () => {
    const html = render('[clic](javascript:alert(1))', 'guide.md');
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).toContain('clic');
  });

  it('retire un src d’image exécutable', () => {
    const html = render('![x](javascript:alert(1))', 'guide.md');
    expect(html).not.toMatch(/src="javascript:/i);
  });

  it('conserve les liens externes avec noopener', () => {
    const html = render('[site](https://exemple.com)', 'guide.md');
    expect(html).toContain('href="https://exemple.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
