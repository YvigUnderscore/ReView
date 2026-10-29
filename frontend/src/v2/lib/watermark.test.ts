// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { escapeXml, watermarkTileUrl } from './watermark';

describe('watermark', () => {
  it('escapes sensitive XML characters', () => {
    expect(escapeXml(`<script>&"'`)).toBe('&lt;script&gt;&amp;&quot;&apos;');
  });

  it('builds a data-URI tile usable as background-image', () => {
    const url = watermarkTileUrl('Client X — 2026');
    expect(url.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(url).toContain(encodeURIComponent('Client X — 2026'));
  });

  it('neutralises an injection attempt in the SVG', () => {
    const url = watermarkTileUrl(`</text><script>alert(1)</script>`);
    expect(url).not.toContain(encodeURIComponent('<script>'));
  });
});
