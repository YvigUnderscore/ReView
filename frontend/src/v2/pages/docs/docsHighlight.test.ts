// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { foldKeepingLength, highlightDocHtml, matchSpans } from './docsHighlight';
import { extractChapters, renderDocHtml, slugifyHeading, type CalloutLabels } from './docsRender';

/**
 * Highlights the searched term in the open page.
 *
 * The pitfall of this function is known in advance: the content is **generated HTML**. A
 * `replace()` on the string would repaint a class name, an `href` or an anchor identifier, and
 * an unclosed `<mark>` in the middle of a tag would break the page. The tests below lock down
 * the three properties that forbid this: only text is touched, neither markup nor anchors are
 * broken, and the user's input cannot inject anything.
 */

const text = (html: string): string => {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl.content.textContent ?? '';
};

/** All anchors of the page, in order: what a highlight must never move. */
const anchors = (html: string): string[] => {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return [...tpl.content.querySelectorAll('[id]')].map((el) => el.getAttribute('id') ?? '');
};

describe('foldKeepingLength', () => {
  it('folds case and accents WITHOUT changing length: positions must remain valid', () => {
    for (const sample of ['Défences', 'ÉÀÇ', 'plain text', 'Ærø', '中文', 'á'])
      expect(foldKeepingLength(sample).length, sample).toBe(sample.length);
    expect(foldKeepingLength('Défences')).toBe('defences');
  });
});

describe('matchSpans', () => {
  it('returns each occurrence, from left to right', () => {
    expect(matchSpans('note and note again', ['note'])).toEqual([
      { start: 0, end: 4 },
      { start: 9, end: 13 },
    ]);
  });

  it('merges overlapping occurrences: one highlight, not two nested ones', () => {
    expect(matchSpans('watermarking', ['watermark', 'marking'])).toEqual([{ start: 0, end: 12 }]);
  });

  it('designates the same characters as before folding', () => {
    const source = 'Les défences du studio';
    const [span] = matchSpans(source, ['defences']);
    expect(source.slice(span.start, span.end)).toBe('défences');
  });
});

describe('highlightDocHtml', () => {
  it('wraps the found term in a <mark> and counts the occurrences', () => {
    const out = highlightDocHtml('<p>The watermark, then the watermark again.</p>', 'watermark');
    expect(out.count).toBe(2);
    expect(out.html).toContain('<mark class="doc-hit" data-doc-hit="first">watermark</mark>');
    expect(out.html).toContain('<mark class="doc-hit">watermark</mark>');
  });

  it('marks only the FIRST occurrence in the page: the one that is jumped to', () => {
    const out = highlightDocHtml('<p>note</p><p>note</p><p>note</p>', 'note');
    expect(out.html.match(/data-doc-hit="first"/g)).toHaveLength(1);
  });

  it('does not touch attributes: anchors, classes and links come out intact', () => {
    const source =
      '<h2 id="viewer-watermark">Viewer watermark</h2>' +
      '<p><a data-doc="admin-guide/secure-distribution.md">watermark</a></p>';
    const out = highlightDocHtml(source, 'watermark');
    expect(out.html).toContain('id="viewer-watermark"');
    expect(out.html).toContain('data-doc="admin-guide/secure-distribution.md"');
    // A word in a class name is not repainted: `doc-callout` survives a search for "note".
    const callout = highlightDocHtml('<div class="doc-callout"><p>A note.</p></div>', 'note');
    expect(callout.html).toContain('class="doc-callout"');
    expect(callout.count).toBe(1);
  });

  it('does not break the structure: the page text is the same as before', () => {
    const source =
      '<div class="doc-table"><table><thead><tr><th>Setting</th></tr></thead>' +
      '<tbody><tr><td>Watermark</td></tr></tbody></table></div>';
    const out = highlightDocHtml(source, 'watermark');
    expect(text(out.html)).toBe(text(source));
    expect(out.html).toContain('<tbody>');
    expect(out.html).toContain('<mark');
  });

  it('highlights ignoring accents, without shifting the text', () => {
    const out = highlightDocHtml('<p>Les défences du studio.</p>', 'DEFENCES');
    expect(out.count).toBe(1);
    expect(out.html).toContain('>défences</mark>');
    expect(text(out.html)).toBe('Les défences du studio.');
  });

  it('is removed by clearing the field: with no search, the page is rendered as is', () => {
    const source = '<p>The watermark.</p>';
    for (const query of ['', '   ', 'a'])
      expect(highlightDocHtml(source, query), query).toEqual({ html: source, count: 0 });
  });

  it('renders the page unchanged when nothing matches', () => {
    const source = '<p>The watermark.</p>';
    expect(highlightDocHtml(source, 'kanban')).toEqual({ html: source, count: 0 });
  });

  it('injects nothing: what looks like a tag stays escaped text', () => {
    // The page text contains "<b>" (escaped by renderDocHtml) and it is that the search finds:
    // the highlight must wrap it escaped, not open a tag.
    const out = highlightDocHtml('<p>a &lt;b&gt; c</p>', '<b>');
    expect(out.count).toBe(1);
    expect(out.html).toContain('&lt;b&gt;</mark>');
    expect(out.html).not.toMatch(/<b>/);
    expect(text(out.html)).toBe('a <b> c');
  });

  it('preserves the entities of the rendered HTML', () => {
    const out = highlightDocHtml('<p>1 &lt; 2 and a &amp; b</p>', 'and');
    expect(out.html).toContain('&lt;');
    expect(out.html).toContain('&amp;');
    expect(text(out.html)).toBe('1 < 2 and a & b');
  });
});

/**
 * The whole engine, end to end: a documentation page as written, rendered by `renderDocHtml`,
 * then highlighted.
 *
 * The composition is what matters here, not each piece: the side table of contents navigates
 * by the **anchors** of the headings, and the chapter panel reads them back from the rendered
 * HTML. If the highlight moved an anchor or renamed a chapter, the page found would open beside
 * what was sought, which is exactly the defect being fixed.
 */
describe('composition with markdown rendering', () => {
  const LABELS: CalloutLabels = {
    note: 'Note',
    tip: 'Astuce',
    important: 'Important',
    warning: 'Avertissement',
    caution: 'Attention',
  };

  const MARKDOWN = [
    '# Secure distribution',
    '',
    '*Everything that leaves the studio.*',
    '',
    '> Updated: 2026-09-20',
    '',
    '## Viewer watermark',
    '',
    'The watermark is burnt into the [proxy](transcoding.md#renditions), never the source.',
    '',
    '> [!WARNING]',
    '> A watermark cannot be removed after publication.',
    '',
    '| Setting | Default |',
    '|---------|---------|',
    '| Watermark | `off` |',
    '',
    '```bash',
    'ffmpeg -i in.mp4 -vf "drawtext=text=watermark" out.mp4',
    '```',
    '',
    '### Défences on the share link',
    '',
    '![A share link carries the watermark policy.](../assets/admin-guide/share.svg)',
  ].join('\n');

  const rendered = renderDocHtml(MARKDOWN, 'admin-guide/secure-distribution.md', LABELS);

  it('highlights the term wherever it reads, titles and tables included', () => {
    const out = highlightDocHtml(rendered, 'watermark');
    // Chapter title, paragraph, callout, cell, code block and caption.
    expect(out.count).toBeGreaterThanOrEqual(6);
  });

  it('moves no anchor and renames no chapter', () => {
    const out = highlightDocHtml(rendered, 'watermark');
    expect(anchors(out.html)).toEqual(anchors(rendered));
    expect(extractChapters(out.html)).toEqual(extractChapters(rendered));
    expect(text(out.html)).toBe(text(rendered));
  });

  it('leaves links, callouts and table structure intact', () => {
    const out = highlightDocHtml(rendered, 'watermark');
    expect(out.html).toContain('data-doc="admin-guide/transcoding.md#renditions"');
    expect(out.html).toContain('data-callout="warning"');
    expect(out.html).toContain('class="doc-table"');
    expect(out.html).toContain('<figcaption>');
  });

  /**
   * The path followed by a click on a chapter found in the table of contents: the label comes
   * from the manifest, the anchor is computed from it, and it must designate the rendered heading.
   */
  it('the anchor computed from a chapter title exists in the rendered page', () => {
    for (const heading of ['Viewer watermark', 'Défences on the share link'])
      expect(anchors(rendered), heading).toContain(slugifyHeading(heading));
  });

  it('also highlights an accented title without breaking its anchor', () => {
    const out = highlightDocHtml(rendered, 'defences');
    expect(out.count).toBe(1);
    expect(anchors(out.html)).toEqual(anchors(rendered));
    expect(out.html).toContain('>Défences</mark>');
  });
});
