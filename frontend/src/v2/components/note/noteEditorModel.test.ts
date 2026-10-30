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

/** The block types opened by the editor, in order. */
const kinds = (source: string) => toEditorBlocks(source).map((b) => b.kind);

/** The full round trip: what is written, opened for editing, then saved again. */
const roundTrip = (source: string) => fromEditorBlocks(toEditorBlocks(source));

describe('toEditorBlocks — opening a note', () => {
  it('flattens sections: the title precedes its blocks, it does not wrap them', () => {
    expect(kinds('## Brief\ndu texte\n\n::progress Anim 40')).toEqual(['heading', 'text', 'progress']);
  });

  it('takes the separator out of the text: it is moved, so it is a block', () => {
    expect(kinds('avant\n\n---\n\napres')).toEqual(['text', 'divider', 'text']);
  });

  it('takes out an image placed on its own, but leaves one inside a sentence', () => {
    expect(kinds('![Ref](a.jpg)')).toEqual(['image']);
    expect(kinds('voir ![Ref](a.jpg) ici')).toEqual(['text']);
  });

  it('reads the layout written in the image title', () => {
    const block = toEditorBlocks('![Ref](a.jpg "align=left width=40")')[0] as ImageEditBlock;
    expect(block).toMatchObject({ kind: 'image', align: 'left', width: 40, src: 'a.jpg' });
  });

  it('opens an adjusted board, and an old carousel stays a carousel', () => {
    const grid = toEditorBlocks('::refs grid cols=2 h=240\n![A](a.jpg)\n::end')[0] as GalleryBlock;
    expect(grid).toMatchObject({ layout: 'grid', cols: 2, height: 240 });

    const legacy = toEditorBlocks('::refs\n![A](a.jpg)\n::end')[0] as GalleryBlock;
    expect(legacy.layout).toBe('carousel');
  });

  it('takes a subheading out of the text, but leaves deeper levels alone', () => {
    expect(kinds('### Cadrage')).toEqual(['title']);
    expect(kinds('#### Détail')).toEqual(['text']);
  });

  it('gives each block its own identifier', () => {
    const blocks = toEditorBlocks('un\n\n---\n\ndeux');
    expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
  });
});

describe('fromEditorBlocks — saving', () => {
  it('produces a note the old reader can read, syntax for syntax', () => {
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

  it('writes a collapsed title with its mark', () => {
    expect(fromEditorBlocks([{ id: 'a', kind: 'heading', title: 'Technique', open: false }])).toBe(
      '##- Technique',
    );
  });

  it("writes a board's options only if it has any", () => {
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

  it("writes an image's layout only if it departs from the usual case", () => {
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

  it('drops empty blocks: one leaves one behind at each hesitation', () => {
    expect(fromEditorBlocks([emptyBlock('text'), emptyBlock('heading'), emptyBlock('gallery')])).toBe('');
  });
});

describe('round trip', () => {
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
    // And a second pass changes nothing: otherwise a note would drift on each opening.
    expect(roundTrip(roundTrip(source))).toBe(source);
  });
});

/** The depth of each block: 0 at the root, 1 inside the section that precedes it. */
const depths = (source: string) => toEditorBlocks(source).map((b) => b.depth ?? 0);

describe('sections — what belongs to what', () => {
  it('files into the section what follows it, up to the next title', () => {
    // heading A · text · subtext · heading B · text
    expect(depths('## A\nun\n\n::small deux\n\n## B\ntrois')).toEqual([0, 1, 1, 0, 1]);
  });

  it('leaves at the root what precedes the first title', () => {
    expect(depths('préambule\n\n## A\ncorps')).toEqual([0, 0, 1]);
  });

  it('files nothing under a subheading: it divides, it does not contain', () => {
    expect(depths('### Cadrage\n\nun')).toEqual([0, 0]);
  });

  it('takes out of the section what follows an explicit end', () => {
    expect(depths('## A\ndedans\n\n::endsection\n\ndehors')).toEqual([0, 1, 0]);
  });
});

describe('setDepth — entering a section, leaving it', () => {
  const blocks = toEditorBlocks('## Technique\n\ndedans');

  it('takes a block out of its section', () => {
    expect(setDepth(blocks, blocks[1].id, 0)[1].depth).toBe(0);
  });

  it('puts it back in', () => {
    const sorti = setDepth(blocks, blocks[1].id, 0);
    expect(setDepth(sorti, sorti[1].id, 1)[1].depth).toBe(1);
  });

  it('refuses to file a block into a section that does not exist yet', () => {
    const plat = toEditorBlocks('un\n\n---\n\ndeux');
    expect(setDepth(plat, plat[2].id, 1)).toBe(plat);
    expect(canIndent(plat, plat[2].id)).toBe(false);
  });

  it('leaves a title at the root: a section does not nest', () => {
    const deux = toEditorBlocks('## A\n\n## B');
    expect(setDepth(deux, deux[1].id, 1)).toBe(deux);
  });

  it('writes the end of a section only where something leaves it', () => {
    const sorti = setDepth(blocks, blocks[1].id, 0);
    expect(fromEditorBlocks(sorti)).toBe('## Technique\n\n::endsection\n\ndedans');
    // Nothing leaves it: nothing closes.
    expect(fromEditorBlocks(blocks)).toBe('## Technique\n\ndedans');
  });

  it('brings back to the root a block taken above the first title', () => {
    const monte = reorderBlocks(blocks, blocks[1].id, 0);
    expect(monte[0].depth).toBe(0);
  });
});

describe('operations', () => {
  const blocks: EditorBlock[] = [
    { id: 'a', kind: 'text', source: 'un' },
    { id: 'b', kind: 'text', source: 'deux' },
    { id: 'c', kind: 'text', source: 'trois' },
  ];

  it('inserts after the given position, and at the head for -1', () => {
    expect(insertBlock(blocks, 0, emptyBlock('divider')).map((b) => b.kind)).toEqual([
      'text',
      'divider',
      'text',
      'text',
    ]);
    expect(insertBlock(blocks, -1, emptyBlock('divider'))[0].kind).toBe('divider');
  });

  it('removes, updates, moves', () => {
    expect(removeBlock(blocks, 'b').map((b) => b.id)).toEqual(['a', 'c']);
    expect(updateBlock(blocks, 'b', { source: 'DEUX' })[1]).toMatchObject({ source: 'DEUX' });
    expect(moveBlock(blocks, 'c', -1).map((b) => b.id)).toEqual(['a', 'c', 'b']);
  });

  it('moves nothing beyond the edges', () => {
    expect(moveBlock(blocks, 'a', -1)).toBe(blocks);
    expect(moveBlock(blocks, 'c', 1)).toBe(blocks);
  });

  it('files a block at the targeted position — the drag-and-drop gesture', () => {
    expect(reorderBlocks(blocks, 'a', 2).map((b) => b.id)).toEqual(['b', 'c', 'a']);
    expect(reorderBlocks(blocks, 'a', 9)).toBe(blocks);
  });
});
