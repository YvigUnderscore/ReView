// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { extractChapters, renderDocHtml, slugifyHeading, type CalloutLabels } from './docsRender';

const LABELS: CalloutLabels = {
  note: 'Note',
  tip: 'Astuce',
  important: 'Important',
  warning: 'Avertissement',
  caution: 'Attention',
};

const render = (markdown: string, path = 'README.md') => renderDocHtml(markdown, path, LABELS);

describe('renderDocHtml', () => {
  it('transforme les liens internes .md en data-doc résolu', () => {
    const html = render('[Errors](../api/errors.md)', 'user-guide/review-video.md');
    expect(html).toContain('data-doc="api/errors.md"');
    expect(html).not.toContain('href="../api/errors.md"');
  });

  it('ouvre les liens externes dans un nouvel onglet', () => {
    const html = render('[Site](https://example.com)');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('data-external');
  });

  it('ne diffère pas le chargement des images', () => {
    // `loading="lazy"` ne se déclenchait jamais dans le conteneur défilant de la page :
    // les captures restaient des carrés de deux pixels, même après avoir défilé jusqu'à
    // elles.
    const html = render('![x](../assets/a.png)', 'user-guide/page.md');
    expect(html).not.toContain('loading');
  });

  it('réécrit les images relatives vers /docs/', () => {
    const html = render('![cap](../assets/user-guide/review-01.png)', 'user-guide/a.md');
    expect(html).toContain('src="/docs/assets/user-guide/review-01.png"');
  });

  it('échappe le HTML brut (convention : markdown pur)', () => {
    const html = render('hello <script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rend les titres et le code', () => {
    const html = render('## Title\n\n`code`');
    expect(html).toContain('<h2');
    expect(html).toContain('<code>code</code>');
  });
});

describe('préambule conventionnel', () => {
  const page =
    '# Video review\n\n*Frame-accurate playback.*\n\n> Updated: 2026-08-23\n\n## Transport\n\nTexte.\n';

  it('retire titre, sous-titre et date — l’en-tête de page les rend lui-même', () => {
    const html = render(page);
    expect(html).not.toContain('<h1');
    expect(html).not.toContain('Frame-accurate playback');
    expect(html).not.toContain('Updated');
    expect(html).toContain('Transport');
  });

  it('ne touche pas une page qui ne commence pas par un titre', () => {
    const html = render('*Juste une italique.*\n\nTexte.\n');
    expect(html).toContain('Juste une italique');
  });

  it('ne retire que le préambule, pas une citation qui suit le titre', () => {
    const html = render('# Titre\n\n> Une citation.\n');
    expect(html).toContain('Une citation');
  });
});

describe('encarts', () => {
  it('transforme `> [!NOTE]` en encart typé, libellé dans la langue du lecteur', () => {
    const html = render('> [!NOTE]\n> Le média publié est verrouillé.');
    expect(html).toContain('data-callout="note"');
    expect(html).toContain('class="doc-callout-label">Note<');
    expect(html).not.toContain('[!NOTE]');
    expect(html).toContain('Le média publié est verrouillé.');
  });

  it('reconnaît les cinq types, quelle que soit la casse', () => {
    for (const kind of ['note', 'tip', 'important', 'warning', 'caution'])
      expect(render(`> [!${kind.toUpperCase()}]\n> x`)).toContain(`data-callout="${kind}"`);
  });

  it('laisse une citation ordinaire en citation', () => {
    const html = render('> Une citation ordinaire.');
    expect(html).toContain('<blockquote>');
    expect(html).not.toContain('doc-callout');
  });
});

describe('figures', () => {
  it('une image seule dans son paragraphe devient une figure légendée', () => {
    const html = render('![The transport bar.](../assets/a.png)', 'user-guide/a.md');
    expect(html).toContain('<figure>');
    expect(html).toContain('<figcaption>The transport bar.</figcaption>');
    // La légende porte la description : l'image n'est plus annoncée une seconde fois.
    expect(html).toContain('alt=""');
  });

  it('une image au fil du texte reste une image', () => {
    const html = render('Voir ![x](../assets/a.png) ici.', 'user-guide/a.md');
    expect(html).not.toContain('<figure>');
  });
});

describe('ancres et sommaire', () => {
  it('pose une ancre sur chaque titre', () => {
    const html = render('## Playback quality\n\n### I/O points\n');
    expect(html).toContain('id="playback-quality"');
    expect(html).toContain('id="io-points"');
  });

  it('numérote les titres répétés', () => {
    const html = render('## Limits\n\ntexte\n\n## Limits\n');
    expect(html).toContain('id="limits"');
    expect(html).toContain('id="limits-1"');
  });

  it('extrait le sommaire du HTML rendu, ancres comprises', () => {
    const chapters = extractChapters(render('## Transport\n\n### Loop\n\n#### Detail\n'));
    expect(chapters).toEqual([
      { id: 'transport', text: 'Transport', level: 2 },
      { id: 'loop', text: 'Loop', level: 3 },
    ]);
  });
});

describe('slugifyHeading', () => {
  it('minuscule, ponctuation retirée, espaces en tirets', () => {
    expect(slugifyHeading('  Loop (I/O points)  ')).toBe('loop-io-points');
  });

  it('suit GitHub au caractère près : la ponctuation retirée laisse son espace', () => {
    // C'est ce qui produit le double tiret, et c'est la forme des liens déjà écrits dans
    // DOCUMENTATION/ — s'en écarter casserait les ancres d'un côté ou de l'autre.
    expect(slugifyHeading('Transport & timeline')).toBe('transport--timeline');
    expect(slugifyHeading('Audit — Admin → Maintenance')).toBe('audit--admin--maintenance');
  });

  it('conserve les lettres accentuées et les alphabets non latins', () => {
    expect(slugifyHeading('Réglages hérités')).toBe('réglages-hérités');
  });

  it('retombe sur un identifiant valide quand il ne reste rien', () => {
    expect(slugifyHeading('***')).toBe('section');
  });
});

describe('tableaux et blocs de code', () => {
  it('enveloppe les tableaux dans un conteneur défilant', () => {
    const html = render('| a | b |\n|---|---|\n| 1 | 2 |\n');
    expect(html).toContain('class="doc-table"');
    expect(html).toContain('<table>');
  });

  it('annonce le langage du bloc de code', () => {
    const html = render('```bash\nnpm run dev\n```\n');
    expect(html).toContain('data-lang="bash"');
  });
});
