// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom
// DOMPurify relies on DOM traversal details happy-dom gets wrong (it keeps <script>); the
// sanitizer is therefore verified against jsdom, closer to a real browser.

import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from './sanitizeHtml';

describe('sanitizeHtml', () => {
  it('removes scripts, event handlers and executable URLs', () => {
    const out = sanitizeHtml(
      '<p onclick="alert(1)">hi</p><script>alert(2)</script><img src="x" onerror="alert(3)"><a href="javascript:alert(4)">x</a><iframe src="https://evil"></iframe>',
    );
    expect(out).not.toMatch(/script|onclick|onerror|javascript:|iframe/i);
    expect(out).toContain('<p>hi</p>');
  });

  it('drops forms and style elements', () => {
    expect(sanitizeHtml('<form action="/x"><input name="a"></form><style>body{}</style>ok')).not.toMatch(
      /<form|<style/,
    );
  });

  it('keeps what the renderers produce: classes, data attributes, inline width, external links', () => {
    const html =
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer" data-external="">x</a>' +
      '<a data-doc="guide/intro.md">doc</a>' +
      '<img src="/docs/a.png" data-align="center" style="width:50%" loading="lazy" decoding="async" alt="">' +
      '<span class="text-primary font-medium">@ana</span>' +
      '<div data-callout="note"><pre data-lang="ts"><code>x</code></pre></div>';
    const out = sanitizeHtml(html);
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('data-external=""');
    expect(out).toContain('data-doc="guide/intro.md"');
    expect(out).toContain('data-align="center"');
    expect(out).toContain('style="width:50%"');
    expect(out).toContain('class="text-primary font-medium"');
    expect(out).toContain('data-callout="note"');
    expect(out).toContain('data-lang="ts"');
  });

  it('leaves plain text untouched', () => {
    expect(sanitizeHtml('a &amp; b')).toBe('a &amp; b');
  });
});
