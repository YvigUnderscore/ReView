// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { parseNote, type SectionBlock } from './noteMarkdown';

/** Reading shortcut: the rendered block types, in order. */
const kinds = (source: string) => parseNote(source).map((b) => b.kind);

describe('parseNote — ordinary markdown', () => {
  it('groups consecutive lines into a single block', () => {
    // Rendering them line by line would break lists, tables and code blocks.
    const blocks = parseNote('- un\n- deux\n- trois');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ kind: 'markdown', source: '- un\n- deux\n- trois' });
  });

  it('produces nothing for an empty note', () => {
    expect(parseNote('')).toEqual([]);
    expect(parseNote('   \n\n  ')).toEqual([]);
  });

  it('leaves the separator to markdown, which already knows how to do it', () => {
    expect(kinds('avant\n\n---\n\napres')).toEqual(['markdown']);
  });
});

describe('parseNote — gauges', () => {
  it('reads a label and a percentage', () => {
    expect(parseNote('::progress Animation 60')).toEqual([
      { kind: 'progress', label: 'Animation', value: 60 },
    ]);
  });

  it('accepts the percent sign and the decimal comma', () => {
    expect(parseNote('::progress Compositing 12,5%')).toEqual([
      { kind: 'progress', label: 'Compositing', value: 12.5 },
    ]);
  });

  it('caps the value: a gauge at 300% would lie about its own scale', () => {
    expect(parseNote('::progress X 300')[0]).toMatchObject({ value: 100 });
    expect(parseNote('::progress X -20')[0]).toMatchObject({ value: 0 });
  });

  it('leaves to markdown a line that does not have the expected form', () => {
    expect(kinds('::progress sans nombre')).toEqual(['markdown']);
  });
});

describe('parseNote — sub-text', () => {
  it('extracts the text', () => {
    expect(parseNote('::small Livré le 12 mars')).toEqual([{ kind: 'small', text: 'Livré le 12 mars' }]);
  });
});

describe('parseNote — reference carousel', () => {
  it('gathers the images of the block, in order', () => {
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

  it('swallows blank lines without closing the block', () => {
    expect(parseNote('::refs\n\n![A](a.jpg)\n\n::end')[0]).toMatchObject({
      images: [{ src: 'a.jpg' }],
    });
  });

  it('renders its images even if "::end" is missing: a brief is not lost over one line', () => {
    expect(parseNote('::refs\n![A](a.jpg)')[0]).toMatchObject({ kind: 'refs' });
  });

  it('does not take an ordinary image for a reference', () => {
    expect(kinds('![A](a.jpg)')).toEqual(['markdown']);
  });
});

describe('parseNote — collapsible sections', () => {
  it('opens a section at each second-level title', () => {
    const blocks = parseNote('## Brief\ntexte\n\n## Technique\nautre');
    expect(kinds('## Brief\ntexte\n\n## Technique\nautre')).toEqual(['section', 'section']);
    expect((blocks[0] as SectionBlock).title).toBe('Brief');
    expect((blocks[0] as SectionBlock).blocks).toEqual([{ kind: 'markdown', source: 'texte' }]);
  });

  it('expands by default, collapses on request', () => {
    expect((parseNote('## Ouvert')[0] as SectionBlock).open).toBe(true);
    expect((parseNote('##- Replié')[0] as SectionBlock).open).toBe(false);
  });

  it('does not nest them: a title closes the previous one', () => {
    // A hierarchy of dropdowns in a brief collapses faster than it can be read.
    const blocks = parseNote('## A\nun\n## B\ndeux');
    expect(blocks).toHaveLength(2);
    expect((blocks[1] as SectionBlock).blocks).toEqual([{ kind: 'markdown', source: 'deux' }]);
  });

  it('keeps at the root what precedes the first title', () => {
    expect(kinds('préambule\n\n## Section\ncorps')).toEqual(['markdown', 'section']);
  });

  it('accepts directives inside a section', () => {
    const section = parseNote('## Avancement\n::progress Anim 40\n::small hier')[0] as SectionBlock;
    expect(section.blocks.map((b) => b.kind)).toEqual(['progress', 'small']);
  });
});

describe('parseNote — robustness', () => {
  it('tolerates Windows line endings', () => {
    expect(kinds('## A\r\ntexte\r\n')).toEqual(['section']);
  });

  it('never renders HTML: the server only stores text', () => {
    const blocks = parseNote('<script>alert(1)</script>');
    // The block stays raw markdown; it is `docsRender` that escapes the HTML at render time.
    expect(blocks[0]).toEqual({ kind: 'markdown', source: '<script>alert(1)</script>' });
  });
});
