// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { parseNote, type SectionBlock } from './noteMarkdown';

/** Raccourci de lecture : les types de blocs rendus, dans l'ordre. */
const kinds = (source: string) => parseNote(source).map((b) => b.kind);

describe('parseNote — markdown ordinaire', () => {
  it('regroupe les lignes consécutives en un seul bloc', () => {
    // Les rendre ligne à ligne casserait listes, tableaux et blocs de code.
    const blocks = parseNote('- un\n- deux\n- trois');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ kind: 'markdown', source: '- un\n- deux\n- trois' });
  });

  it('ne produit rien pour une fiche vide', () => {
    expect(parseNote('')).toEqual([]);
    expect(parseNote('   \n\n  ')).toEqual([]);
  });

  it('laisse le séparateur au markdown, qui sait déjà le faire', () => {
    expect(kinds('avant\n\n---\n\napres')).toEqual(['markdown']);
  });
});

describe('parseNote — jauges', () => {
  it('lit un libellé et un pourcentage', () => {
    expect(parseNote('::progress Animation 60')).toEqual([
      { kind: 'progress', label: 'Animation', value: 60 },
    ]);
  });

  it('accepte le signe pour cent et la virgule décimale', () => {
    expect(parseNote('::progress Compositing 12,5%')).toEqual([
      { kind: 'progress', label: 'Compositing', value: 12.5 },
    ]);
  });

  it('borne la valeur : une jauge à 300 % mentirait sur sa propre échelle', () => {
    expect(parseNote('::progress X 300')[0]).toMatchObject({ value: 100 });
    expect(parseNote('::progress X -20')[0]).toMatchObject({ value: 0 });
  });

  it('laisse au markdown une ligne qui n’a pas la forme attendue', () => {
    expect(kinds('::progress sans nombre')).toEqual(['markdown']);
  });
});

describe('parseNote — sous-texte', () => {
  it('extrait le texte', () => {
    expect(parseNote('::small Livré le 12 mars')).toEqual([{ kind: 'small', text: 'Livré le 12 mars' }]);
  });
});

describe('parseNote — carrousel de références', () => {
  it('rassemble les images du bloc, dans l’ordre', () => {
    const blocks = parseNote('::refs\n![Lumière](a.jpg)\n![Planche](b.png)\n::end');
    expect(blocks).toEqual([
      {
        kind: 'refs',
        images: [
          { alt: 'Lumière', src: 'a.jpg' },
          { alt: 'Planche', src: 'b.png' },
        ],
      },
    ]);
  });

  it('avale les lignes vides sans fermer le bloc', () => {
    expect(parseNote('::refs\n\n![A](a.jpg)\n\n::end')[0]).toMatchObject({
      images: [{ src: 'a.jpg' }],
    });
  });

  it('rend ses images même si « ::end » manque — un brief ne se perd pas pour une ligne', () => {
    expect(parseNote('::refs\n![A](a.jpg)')[0]).toMatchObject({ kind: 'refs' });
  });

  it('ne prend pas une image ordinaire pour une référence', () => {
    expect(kinds('![A](a.jpg)')).toEqual(['markdown']);
  });
});

describe('parseNote — sections dépliables', () => {
  it('ouvre une section à chaque titre de niveau deux', () => {
    const blocks = parseNote('## Brief\ntexte\n\n## Technique\nautre');
    expect(kinds('## Brief\ntexte\n\n## Technique\nautre')).toEqual(['section', 'section']);
    expect((blocks[0] as SectionBlock).title).toBe('Brief');
    expect((blocks[0] as SectionBlock).blocks).toEqual([{ kind: 'markdown', source: 'texte' }]);
  });

  it('déplie par défaut, replie sur demande', () => {
    expect((parseNote('## Ouvert')[0] as SectionBlock).open).toBe(true);
    expect((parseNote('##- Replié')[0] as SectionBlock).open).toBe(false);
  });

  it('ne les imbrique pas : un titre ferme le précédent', () => {
    // Une hiérarchie de dépliants dans un brief se replie plus vite qu'elle ne se lit.
    const blocks = parseNote('## A\nun\n## B\ndeux');
    expect(blocks).toHaveLength(2);
    expect((blocks[1] as SectionBlock).blocks).toEqual([{ kind: 'markdown', source: 'deux' }]);
  });

  it('garde ce qui précède le premier titre à la racine', () => {
    expect(kinds('préambule\n\n## Section\ncorps')).toEqual(['markdown', 'section']);
  });

  it('accueille les directives dans une section', () => {
    const section = parseNote('## Avancement\n::progress Anim 40\n::small hier')[0] as SectionBlock;
    expect(section.blocks.map((b) => b.kind)).toEqual(['progress', 'small']);
  });
});

describe('parseNote — robustesse', () => {
  it('tolère les fins de ligne Windows', () => {
    expect(kinds('## A\r\ntexte\r\n')).toEqual(['section']);
  });

  it('ne rend jamais de HTML : le serveur ne stocke que du texte', () => {
    const blocks = parseNote('<script>alert(1)</script>');
    // Le bloc reste du markdown brut ; c'est `docsRender` qui échappe le HTML au rendu.
    expect(blocks[0]).toEqual({ kind: 'markdown', source: '<script>alert(1)</script>' });
  });
});
