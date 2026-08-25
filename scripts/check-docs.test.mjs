// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  figureProblems,
  headingAnchors,
  missingPreamble,
  references,
  slugifyHeading,
} from './check-docs.mjs';

describe('slugifyHeading', () => {
  it('suit GitHub : minuscules, ponctuation retirée, chaque espace devenu tiret', () => {
    expect(slugifyHeading('Playback quality')).toBe('playback-quality');
    expect(slugifyHeading('Transport & timeline')).toBe('transport--timeline');
    expect(slugifyHeading('  Loop (I/O points)  ')).toBe('loop-io-points');
  });

  it('conserve accents et tiret bas', () => {
    expect(slugifyHeading('Réglages hérités')).toBe('réglages-hérités');
    expect(slugifyHeading('MEDIA_ROOT')).toBe('media_root');
  });

  it('rend une ancre valable quand il ne reste rien', () => {
    expect(slugifyHeading('***')).toBe('section');
  });
});

describe('headingAnchors', () => {
  it('relève les titres de niveau 1 à 4', () => {
    expect(headingAnchors('# A\n\n## B\n\n### C\n\n##### E\n')).toEqual(['a', 'b', 'c']);
  });

  it('numérote les titres répétés, comme l’application', () => {
    expect(headingAnchors('## Limits\n\n## Limits\n')).toEqual(['limits', 'limits-1']);
  });

  it('ignore un dièse à l’intérieur d’un bloc de code', () => {
    expect(headingAnchors('## Vrai\n\n```bash\n# commentaire shell\n```\n')).toEqual(['vrai']);
  });

  it('retire le markdown en ligne du texte du titre', () => {
    expect(headingAnchors('## The **review** `workspace`\n')).toEqual(['the-review-workspace']);
  });
});

describe('missingPreamble', () => {
  const page = '# Video review\n\n*Frame-accurate playback.*\n\n> Updated: 2026-08-23\n\n## Transport\n';

  it('ne reproche rien à une page conforme', () => {
    expect(missingPreamble(page)).toEqual([]);
  });

  it('relève le titre, le sous-titre et la date manquants', () => {
    expect(missingPreamble('Texte sans rien.\n')).toHaveLength(3);
  });

  it('ne prend pas un paragraphe en gras pour un sous-titre', () => {
    expect(missingPreamble('# T\n\n**Gras.**\n\n> Updated: 2026-08-23\n')).toEqual([
      'sous-titre en italique (*…*)',
    ]);
  });

  it('exige une date complète', () => {
    expect(missingPreamble('# T\n\n*S.*\n\n> Updated: soon\n')).toEqual(['ligne « > Updated: AAAA-MM-JJ »']);
  });
});

describe('references', () => {
  it('distingue les images des liens', () => {
    expect(references('![Une figure](../assets/a.svg) et [une page](b.md)')).toEqual([
      { image: true, text: 'Une figure', target: '../assets/a.svg' },
      { image: false, text: 'une page', target: 'b.md' },
    ]);
  });

  it('ignore ce qui vit dans un bloc de code — un exemple n’est pas un lien', () => {
    expect(references('```md\n[exemple](inexistant.md)\n```\n\n[vrai](a.md)')).toEqual([
      { image: false, text: 'vrai', target: 'a.md' },
    ]);
  });
});

describe('figureProblems', () => {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" role="img" aria-labelledby="t">',
    '<title id="t">Titre</title>',
    '<style>.a{fill:#111}@media (prefers-color-scheme: dark){.a{fill:#eee}}</style>',
    '<g><rect class="a" x="0" y="0" width="10" height="10"/></g>',
    '</svg>',
  ].join('\n');

  it('ne reproche rien à une figure conforme', () => {
    expect(figureProblems(svg)).toEqual([]);
  });

  it('relève l’absence de viewBox, de titre, de rôle et de variante sombre', () => {
    expect(figureProblems('<svg xmlns="x"><rect/></svg>')).toHaveLength(4);
  });

  it('relève une balise laissée ouverte', () => {
    const broken = svg.replace('</svg>', '');
    expect(figureProblems(broken).join(' ')).toMatch(/non fermée/);
  });

  it('ne prend pas les éléments sans contenu pour des balises ouvertes', () => {
    expect(
      figureProblems(
        svg.replace(
          '<rect class="a" x="0" y="0" width="10" height="10"/>',
          '<path d="M0 0"/><circle r="1"/><line x1="0"/>',
        ),
      ),
    ).toEqual([]);
  });
});
