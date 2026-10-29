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
  it('turns internal .md links into a resolved data-doc', () => {
    const html = render('[Errors](../api/errors.md)', 'user-guide/review-video.md');
    expect(html).toContain('data-doc="api/errors.md"');
    expect(html).not.toContain('href="../api/errors.md"');
  });

  it('opens external links in a new tab', () => {
    const html = render('[Site](https://example.com)');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('data-external');
  });

  it('does not defer image loading', () => {
    // `loading="lazy"` never triggered in the page's scrolling container: the captures stayed
    // two-pixel squares, even after scrolling down to them.
    const html = render('![x](../assets/a.png)', 'user-guide/page.md');
    expect(html).not.toContain('loading');
  });

  it('rewrites relative images to /docs/', () => {
    const html = render('![cap](../assets/user-guide/review-01.png)', 'user-guide/a.md');
    expect(html).toContain('src="/docs/assets/user-guide/review-01.png"');
  });

  it('escapes raw HTML (convention: pure markdown)', () => {
    const html = render('hello <script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders headings and code', () => {
    const html = render('## Title\n\n`code`');
    expect(html).toContain('<h2');
    expect(html).toContain('<code>code</code>');
  });
});

describe('conventional preamble', () => {
  const page =
    '# Video review\n\n*Frame-accurate playback.*\n\n> Updated: 2026-08-23\n\n## Transport\n\nTexte.\n';

  it('removes the title, subtitle and date: the page header renders them itself', () => {
    const html = render(page);
    expect(html).not.toContain('<h1');
    expect(html).not.toContain('Frame-accurate playback');
    expect(html).not.toContain('Updated');
    expect(html).toContain('Transport');
  });

  it('does not touch a page that does not start with a title', () => {
    const html = render('*Juste une italique.*\n\nTexte.\n');
    expect(html).toContain('Juste une italique');
  });

  it('removes only the preamble, not a quote that follows the title', () => {
    const html = render('# Titre\n\n> Une citation.\n');
    expect(html).toContain('Une citation');
  });
});

describe('callouts', () => {
  it('turns `> [!NOTE]` into a typed callout, labelled in the reader language', () => {
    const html = render('> [!NOTE]\n> Le média publié est verrouillé.');
    expect(html).toContain('data-callout="note"');
    expect(html).toContain('class="doc-callout-label">Note<');
    expect(html).not.toContain('[!NOTE]');
    expect(html).toContain('Le média publié est verrouillé.');
  });

  it('recognizes the five types, whatever the case', () => {
    for (const kind of ['note', 'tip', 'important', 'warning', 'caution'])
      expect(render(`> [!${kind.toUpperCase()}]\n> x`)).toContain(`data-callout="${kind}"`);
  });

  it('leaves an ordinary quote as a quote', () => {
    const html = render('> Une citation ordinaire.');
    expect(html).toContain('<blockquote>');
    expect(html).not.toContain('doc-callout');
  });
});

describe('figures', () => {
  it('a lone image in its paragraph becomes a captioned figure', () => {
    const html = render('![The transport bar.](../assets/a.png)', 'user-guide/a.md');
    expect(html).toContain('<figure>');
    expect(html).toContain('<figcaption>The transport bar.</figcaption>');
    // The caption carries the description: the image is no longer announced a second time.
    expect(html).toContain('alt=""');
  });

  it('an image inline with the text stays an image', () => {
    const html = render('Voir ![x](../assets/a.png) ici.', 'user-guide/a.md');
    expect(html).not.toContain('<figure>');
  });
});

describe('anchors and table of contents', () => {
  it('places an anchor on each heading', () => {
    const html = render('## Playback quality\n\n### I/O points\n');
    expect(html).toContain('id="playback-quality"');
    expect(html).toContain('id="io-points"');
  });

  it('numbers repeated headings', () => {
    const html = render('## Limits\n\ntexte\n\n## Limits\n');
    expect(html).toContain('id="limits"');
    expect(html).toContain('id="limits-1"');
  });

  it('extracts the table of contents from the rendered HTML, anchors included', () => {
    const chapters = extractChapters(render('## Transport\n\n### Loop\n\n#### Detail\n'));
    expect(chapters).toEqual([
      { id: 'transport', text: 'Transport', level: 2 },
      { id: 'loop', text: 'Loop', level: 3 },
    ]);
  });
});

describe('slugifyHeading', () => {
  it('lowercases, removes punctuation, and turns spaces into dashes', () => {
    expect(slugifyHeading('  Loop (I/O points)  ')).toBe('loop-io-points');
  });

  it('follows GitHub to the character: the space left by removed punctuation is kept', () => {
    // This is what produces the double dash, and it is the form of the links already written in
    // DOCUMENTATION/: deviating from it would break anchors on one side or the other.
    expect(slugifyHeading('Transport & timeline')).toBe('transport--timeline');
    expect(slugifyHeading('Audit — Admin → Maintenance')).toBe('audit--admin--maintenance');
  });

  it('keeps accented letters and non-Latin alphabets', () => {
    expect(slugifyHeading('Réglages hérités')).toBe('réglages-hérités');
  });

  it('falls back to a valid identifier when nothing remains', () => {
    expect(slugifyHeading('***')).toBe('section');
  });
});

describe('tables and code blocks', () => {
  it('wraps tables in a scrolling container', () => {
    const html = render('| a | b |\n|---|---|\n| 1 | 2 |\n');
    expect(html).toContain('class="doc-table"');
    expect(html).toContain('<table>');
  });

  it('announces the language of the code block', () => {
    const html = render('```bash\nnpm run dev\n```\n');
    expect(html).toContain('data-lang="bash"');
  });
});
