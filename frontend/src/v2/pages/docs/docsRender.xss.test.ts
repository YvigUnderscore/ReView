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
 * The raw HTML of markdown is escaped by the renderer, but not the URLs that marked builds
 * itself: `[click](javascript:…)` produced an executable href on the application's origin,
 * where the session token lives.
 */
describe('isUnsafeHref', () => {
  it('detects executable protocols', () => {
    for (const u of ['javascript:alert(1)', 'JavaScript:alert(1)', 'vbscript:msgbox', 'data:text/html,x'])
      expect(isUnsafeHref(u), u).toBe(true);
  });

  it('is not fooled by interleaved spaces and control characters', () => {
    for (const u of ['java\tscript:alert(1)', ' javascript:alert(1)', 'java\nscript:alert(1)'])
      expect(isUnsafeHref(u), JSON.stringify(u)).toBe(true);
  });

  it('lets normal links through', () => {
    for (const u of ['https://exemple.com', '/docs/x.md', '#ancre', 'mailto:a@b.c'])
      expect(isUnsafeHref(u), u).toBe(false);
  });

  it('tolerates data:image in an image, but not in a link', () => {
    expect(isUnsafeSrc('data:image/png;base64,AAA')).toBe(false);
    expect(isUnsafeHref('data:image/png;base64,AAA')).toBe(true);
    expect(isUnsafeSrc('javascript:alert(1)')).toBe(true);
  });
});

describe('renderDocHtml', () => {
  it('removes a javascript: href produced by markdown', () => {
    const html = render('[clic](javascript:alert(1))', 'guide.md');
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).toContain('clic');
  });

  it('removes an executable image src', () => {
    const html = render('![x](javascript:alert(1))', 'guide.md');
    expect(html).not.toMatch(/src="javascript:/i);
  });

  it('keeps external links with noopener', () => {
    const html = render('[site](https://exemple.com)', 'guide.md');
    expect(html).toContain('href="https://exemple.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
