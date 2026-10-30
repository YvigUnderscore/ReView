// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { renderNotesSheet, sanitizeInlineSvg, type SheetLabels, type SheetNote } from './notesSheetHtml';
import { annotationToSvg } from './annotationSvg';

/**
 * The sheet is the only HTML ReView composes from text typed by users that someone will open in a browser. Two
 * requirements: nothing executable may enter it, and the commented frame must be visible in it.
 */

const labels: SheetLabels = {
  frame: 'Frame',
  timecode: 'Timecode',
  state: 'State',
  decision: 'Decision',
  noFrame: 'No frame available',
  printHint: 'Print this page',
  empty: 'No notes to print here.',
  reply: 'Reply',
};

const note = (over: Partial<SheetNote> = {}): SheetNote => ({
  location: 'SQ010 · SH020 › comp · v003',
  frame: '1024',
  timecode: '00:00:00:23',
  author: 'Alice',
  createdAt: '2026-08-21 10:30',
  state: 'OPEN',
  decision: 'Retake',
  text: 'flicker à gauche',
  image: null,
  annotationSvg: null,
  reply: false,
  ...over,
});

describe('sanitizeInlineSvg', () => {
  it('lets an ordinary annotation SVG through', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect x="1" y="2" stroke="#FF3B30" /></svg>';
    expect(sanitizeInlineSvg(svg)).toBe(svg);
  });

  it('rejects an SVG whose colour closed the attribute to inject a handler', () => {
    const svg = '<svg><rect stroke="" onload="alert(1)" /></svg>';
    expect(sanitizeInlineSvg(svg)).toBeNull();
  });

  it('rejects script, foreignObject and executable URLs', () => {
    expect(sanitizeInlineSvg('<svg><script>alert(1)</script></svg>')).toBeNull();
    expect(sanitizeInlineSvg('<svg><foreignObject><b>x</b></foreignObject></svg>')).toBeNull();
    expect(sanitizeInlineSvg('<svg><a href="javascript:alert(1)">x</a></svg>')).toBeNull();
  });

  it('returns null when there is nothing to draw', () => {
    expect(sanitizeInlineSvg(null)).toBeNull();
  });
});

describe('renderNotesSheet', () => {
  it('composes a standalone document with the title and the print help', () => {
    const html = renderNotesSheet({
      title: 'Review notes',
      subtitle: 'Projet — SH020',
      labels,
      notes: [],
      truncated: null,
    });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>Review notes</title>');
    expect(html).toContain('Print this page');
    expect(html).toContain('No notes to print here.');
  });

  it('escapes the text of a note that contains markup', () => {
    const html = renderNotesSheet({
      title: 't',
      subtitle: 's',
      labels,
      notes: [note({ text: '<img src=x onerror=alert(1)>' })],
      truncated: null,
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('shows the time marker, status and decision of each note', () => {
    const html = renderNotesSheet({ title: 't', subtitle: 's', labels, notes: [note()], truncated: null });
    expect(html).toContain('Frame <b>1024</b>');
    expect(html).toContain('Timecode <b>00:00:00:23</b>');
    expect(html).toContain('Decision <b>Retake</b>');
    expect(html).toContain('SQ010 · SH020 › comp · v003');
  });

  it('cuts the thumbnail out of the sprite and places the annotation over it', () => {
    const html = renderNotesSheet({
      title: 't',
      subtitle: 's',
      labels,
      notes: [
        note({
          image: {
            src: 'data:image/jpeg;base64,AAA',
            width: 160,
            height: 90,
            tile: { offsetX: 320, offsetY: 90, sheetWidth: 1600, sheetHeight: 180 },
          },
          annotationSvg: '<svg xmlns="http://www.w3.org/2000/svg"><rect x="1" /></svg>',
        }),
      ],
      truncated: null,
    });
    expect(html).toContain('background-position:-320px -90px');
    expect(html).toContain('background-size:1600px 180px');
    expect(html).toContain('<rect x="1" />');
  });

  it('announces the fallback when no image is available', () => {
    const html = renderNotesSheet({ title: 't', subtitle: 's', labels, notes: [note()], truncated: null });
    expect(html).toContain('No frame available');
  });

  it('indents a reply and flags the truncation', () => {
    const html = renderNotesSheet({
      title: 't',
      subtitle: 's',
      labels,
      notes: [note({ reply: true })],
      truncated: 'Only the first 200 notes are shown.',
    });
    expect(html).toContain('note--reply');
    expect(html).toContain('Only the first 200 notes are shown.');
  });
});

/**
 * The filter was caught out on 2026-09-16: its handler rule required a WHITESPACE before (`\son…=`), so an `/onbegin=`
 * — a form the HTML parser accepts to separate two attributes — went through intact. These tests pin down the exact
 * forms that got through.
 */
describe('sanitizeInlineSvg — bypasses', () => {
  it('rejects a handler introduced by a solidus', () => {
    const svg =
      '<svg><rect stroke="#fff"/><animate attributeName="x"/onbegin="fetch(\'https://evil.example\')" /></svg>';
    expect(sanitizeInlineSvg(svg)).toBeNull();
  });

  it('rejects a handler glued to the closing quote of the previous attribute', () => {
    expect(sanitizeInlineSvg('<svg><rect stroke="#fff"onload="alert(1)" /></svg>')).toBeNull();
  });

  it('rejects animation, style and link tags', () => {
    for (const tag of ['animate', 'set', 'animateTransform', 'style', 'a', 'switch', 'handler']) {
      expect(sanitizeInlineSvg(`<svg><${tag}>x</${tag}></svg>`)).toBeNull();
    }
  });

  it('rejects a comment, a processing instruction or a lone angle bracket', () => {
    expect(sanitizeInlineSvg('<svg><!--<script>alert(1)</script>--></svg>')).toBeNull();
    expect(sanitizeInlineSvg('<svg><?xml-stylesheet href="x"?></svg>')).toBeNull();
    expect(sanitizeInlineSvg('<svg>< </svg>')).toBeNull();
  });

  it('rejects an href, the only way for a shape to point elsewhere', () => {
    expect(sanitizeInlineSvg('<svg><text xlink:href="https://evil.example">x</text></svg>')).toBeNull();
  });

  it('lets through the SVG the renderer actually produces', () => {
    const svg = annotationToSvg(
      [
        { type: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2, color: '#ef4444' },
        { type: 'arrow', x1: 0, y1: 0, x2: 0.5, y2: 0.5 },
        {
          type: 'path',
          pts: [
            [0, 0],
            [1, 1],
          ],
        },
        { type: 'ellipse', cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.1 },
        { type: 'text', x: 0.2, y: 0.2, text: 'flicker' },
      ],
      1920,
      1080,
    );
    expect(sanitizeInlineSvg(svg)).toBe(svg);
  });

  it('lets through the rendering of a trapped colour, now neutralised upstream', () => {
    // The defence lives in `annotationSvg`: the filter has nothing left to reject.
    const svg = annotationToSvg(
      [{ type: 'rect', w: 0.1, h: 0.1, color: '#fff"/><animate attributeName="x"/onbegin="alert(1)' }],
      160,
      90,
    );
    expect(sanitizeInlineSvg(svg)).toBe(svg);
    expect(svg).not.toContain('onbegin');
  });
});

describe('renderNotesSheet — image sources', () => {
  const sheet = (src: string) =>
    renderNotesSheet({
      title: 't',
      subtitle: 's',
      labels,
      notes: [note({ image: { src, width: 160, height: 90 } })],
      truncated: null,
    });

  it('embeds only data URIs: the document is meant to be standalone', () => {
    const html = sheet('https://tracker.example/pixel.png');
    expect(html).not.toContain('tracker.example');
    expect(html).toContain('No frame available');
  });

  it('refuses a source that would break out of the CSS url() or the attribute', () => {
    expect(sheet("data:image/png;base64,AAA');background-image:url('https://evil.example/x")).not.toContain(
      'evil.example',
    );
    expect(sheet('data:image/png;base64,AAA" onerror="alert(1)')).not.toContain('onerror');
  });

  it('refuses an SVG, the only image format that embeds markup', () => {
    expect(sheet('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).not.toContain('svg+xml');
  });

  it('bounds the dimensions written into the style', () => {
    const html = renderNotesSheet({
      title: 't',
      subtitle: 's',
      labels,
      notes: [
        note({
          image: {
            src: 'data:image/jpeg;base64,AAA',
            width: NaN,
            height: -4,
            tile: { offsetX: NaN, offsetY: 1.6, sheetWidth: 1600, sheetHeight: 180 },
          },
        }),
      ],
      truncated: null,
    });
    expect(html).not.toContain('NaN');
    expect(html).toContain('background-position:-0px -2px');
  });
});
