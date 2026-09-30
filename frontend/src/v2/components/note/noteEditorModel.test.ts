// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  emptyBlock,
  fromEditorBlocks,
  insertBlock,
  moveBlock,
  removeBlock,
  canIndent,
  reorderBlocks,
  setDepth,
  toEditorBlocks,
  updateBlock,
  type EditorBlock,
  type GalleryBlock,
  type ImageEditBlock,
} from './noteEditorModel';

/** Les types de blocs ouverts par l'éditeur, dans l'ordre. */
const kinds = (source: string) => toEditorBlocks(source).map((b) => b.kind);

/** Le tour complet : ce qui est écrit, ouvert à l'édition, puis réenregistré. */
const roundTrip = (source: string) => fromEditorBlocks(toEditorBlocks(source));

describe('toEditorBlocks — ouverture d’une fiche', () => {
  it('aplatit les sections : le titre précède ses blocs, il ne les enveloppe pas', () => {
    expect(kinds('## Brief\ndu texte\n\n::progress Anim 40')).toEqual(['heading', 'text', 'progress']);
  });

  it('sort le séparateur du texte — on le déplace, donc c’est un bloc', () => {
    expect(kinds('avant\n\n---\n\napres')).toEqual(['text', 'divider', 'text']);
  });

  it('sort une image posée seule, mais laisse celle qui est dans une phrase', () => {
    expect(kinds('![Ref](a.jpg)')).toEqual(['image']);
    expect(kinds('voir ![Ref](a.jpg) ici')).toEqual(['text']);
  });

  it('lit la disposition écrite dans le titre de l’image', () => {
    const block = toEditorBlocks('![Ref](a.jpg "align=left width=40")')[0] as ImageEditBlock;
    expect(block).toMatchObject({ kind: 'image', align: 'left', width: 40, src: 'a.jpg' });
  });

  it('ouvre une planche réglée, et un carrousel ancien reste un carrousel', () => {
    const grid = toEditorBlocks('::refs grid cols=2 h=240\n![A](a.jpg)\n::end')[0] as GalleryBlock;
    expect(grid).toMatchObject({ layout: 'grid', cols: 2, height: 240 });

    const legacy = toEditorBlocks('::refs\n![A](a.jpg)\n::end')[0] as GalleryBlock;
    expect(legacy.layout).toBe('carousel');
  });

  it('sort un intertitre du texte, mais laisse les niveaux plus profonds tranquilles', () => {
    expect(kinds('### Cadrage')).toEqual(['title']);
    expect(kinds('#### Détail')).toEqual(['text']);
  });

  it('donne à chaque bloc un identifiant qui lui est propre', () => {
    const blocks = toEditorBlocks('un\n\n---\n\ndeux');
    expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
  });
});

describe('fromEditorBlocks — enregistrement', () => {
  it('rend une fiche relisible par l’ancien lecteur, syntaxe pour syntaxe', () => {
    const blocks: EditorBlock[] = [
      { id: 'a', kind: 'heading', title: 'Brief', open: true },
      { id: 'b', kind: 'text', source: 'Ambiance de nuit.' },
      { id: 'c', kind: 'progress', label: 'Animation', value: 60 },
      { id: 'd', kind: 'small', text: 'Livré le 12 mars' },
      { id: 'e', kind: 'divider' },
    ];
    expect(fromEditorBlocks(blocks)).toBe(
      '## Brief\n\nAmbiance de nuit.\n\n::progress Animation 60\n\n::small Livré le 12 mars\n\n---',
    );
  });

  it('écrit un titre replié avec sa marque', () => {
    expect(fromEditorBlocks([{ id: 'a', kind: 'heading', title: 'Technique', open: false }])).toBe(
      '##- Technique',
    );
  });

  it('n’écrit les options d’une planche que si elle en a', () => {
    const carousel: GalleryBlock = {
      id: 'g',
      kind: 'gallery',
      images: [{ src: 'a.jpg', alt: 'A' }],
      layout: 'carousel',
      cols: 3,
      height: 180,
    };
    expect(fromEditorBlocks([carousel])).toBe('::refs\n![A](a.jpg)\n::end');
    expect(fromEditorBlocks([{ ...carousel, layout: 'grid' }])).toBe(
      '::refs grid cols=3 h=180\n![A](a.jpg)\n::end',
    );
  });

  it('n’écrit la disposition d’une image que si elle sort du cas courant', () => {
    const image: ImageEditBlock = {
      id: 'i',
      kind: 'image',
      src: 'a.jpg',
      alt: 'A',
      align: 'full',
      width: 100,
    };
    expect(fromEditorBlocks([image])).toBe('![A](a.jpg)');
    expect(fromEditorBlocks([{ ...image, align: 'right', width: 40 }])).toBe(
      '![A](a.jpg "align=right width=40")',
    );
  });

  it('laisse tomber les blocs vides — on en abandonne un à chaque hésitation', () => {
    expect(fromEditorBlocks([emptyBlock('text'), emptyBlock('heading'), emptyBlock('gallery')])).toBe('');
  });
});

describe('aller-retour', () => {
  it.each([
    '## Brief\n\nAmbiance de nuit.\n\n::progress Animation 60',
    '##- Technique\n\n::small Rendu en 2K\n\n---\n\n![A](a.jpg "align=left width=40")',
    '::refs grid cols=4 h=120\n![Une](a.jpg)\n![Deux](b.png)\n::end',
    '::refs\n![Une](a.jpg)\n::end',
    '### Cadrage\n\nUn texte sous l’intertitre.',
    '## Technique\n\ndedans\n\n::endsection\n\ndehors',
    '- un\n- deux\n- trois',
  ])('ne déforme pas la fiche : %s', (source) => {
    expect(roundTrip(source)).toBe(source);
    // Et un second passage ne bouge plus : sans cela, une fiche dériverait à chaque ouverture.
    expect(roundTrip(roundTrip(source))).toBe(source);
  });
});

/** La profondeur de chaque bloc — 0 à la racine, 1 dans la section qui précède. */
const depths = (source: string) => toEditorBlocks(source).map((b) => b.depth ?? 0);

describe('sections — ce qui appartient à quoi', () => {
  it('range dans la section ce qui la suit, jusqu’au titre suivant', () => {
    // heading A · texte · sous-texte · heading B · texte
    expect(depths('## A\nun\n\n::small deux\n\n## B\ntrois')).toEqual([0, 1, 1, 0, 1]);
  });

  it('laisse à la racine ce qui précède le premier titre', () => {
    expect(depths('préambule\n\n## A\ncorps')).toEqual([0, 0, 1]);
  });

  it('ne range rien sous un intertitre : il découpe, il ne contient pas', () => {
    expect(depths('### Cadrage\n\nun')).toEqual([0, 0]);
  });

  it('sort de la section ce qui suit une fin explicite', () => {
    expect(depths('## A\ndedans\n\n::endsection\n\ndehors')).toEqual([0, 1, 0]);
  });
});

describe('setDepth — entrer dans une section, en sortir', () => {
  const blocks = toEditorBlocks('## Technique\n\ndedans');

  it('sort un bloc de sa section', () => {
    expect(setDepth(blocks, blocks[1].id, 0)[1].depth).toBe(0);
  });

  it('l’y remet', () => {
    const sorti = setDepth(blocks, blocks[1].id, 0);
    expect(setDepth(sorti, sorti[1].id, 1)[1].depth).toBe(1);
  });

  it('refuse de ranger un bloc dans une section qui n’existe pas encore', () => {
    const plat = toEditorBlocks('un\n\n---\n\ndeux');
    expect(setDepth(plat, plat[2].id, 1)).toBe(plat);
    expect(canIndent(plat, plat[2].id)).toBe(false);
  });

  it('laisse un titre à la racine : une section ne s’imbrique pas', () => {
    const deux = toEditorBlocks('## A\n\n## B');
    expect(setDepth(deux, deux[1].id, 1)).toBe(deux);
  });

  it('n’écrit la fin de section que là où quelque chose en sort', () => {
    const sorti = setDepth(blocks, blocks[1].id, 0);
    expect(fromEditorBlocks(sorti)).toBe('## Technique\n\n::endsection\n\ndedans');
    // Rien n'en sort : rien ne se ferme.
    expect(fromEditorBlocks(blocks)).toBe('## Technique\n\ndedans');
  });

  it('ramène à la racine un bloc emmené au-dessus du premier titre', () => {
    const monte = reorderBlocks(blocks, blocks[1].id, 0);
    expect(monte[0].depth).toBe(0);
  });
});

describe('manipulations', () => {
  const blocks: EditorBlock[] = [
    { id: 'a', kind: 'text', source: 'un' },
    { id: 'b', kind: 'text', source: 'deux' },
    { id: 'c', kind: 'text', source: 'trois' },
  ];

  it('insère après la position donnée, et en tête pour -1', () => {
    expect(insertBlock(blocks, 0, emptyBlock('divider')).map((b) => b.kind)).toEqual([
      'text',
      'divider',
      'text',
      'text',
    ]);
    expect(insertBlock(blocks, -1, emptyBlock('divider'))[0].kind).toBe('divider');
  });

  it('retire, met à jour, déplace', () => {
    expect(removeBlock(blocks, 'b').map((b) => b.id)).toEqual(['a', 'c']);
    expect(updateBlock(blocks, 'b', { source: 'DEUX' })[1]).toMatchObject({ source: 'DEUX' });
    expect(moveBlock(blocks, 'c', -1).map((b) => b.id)).toEqual(['a', 'c', 'b']);
  });

  it('ne déplace rien au-delà des bords', () => {
    expect(moveBlock(blocks, 'a', -1)).toBe(blocks);
    expect(moveBlock(blocks, 'c', 1)).toBe(blocks);
  });

  it('range un bloc à la position visée — le geste du glisser-déposer', () => {
    expect(reorderBlocks(blocks, 'a', 2).map((b) => b.id)).toEqual(['b', 'c', 'a']);
    expect(reorderBlocks(blocks, 'a', 9)).toBe(blocks);
  });
});
