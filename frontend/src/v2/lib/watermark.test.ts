// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { escapeXml, watermarkTileUrl } from './watermark';

describe('watermark', () => {
  it('échappe les caractères XML sensibles', () => {
    expect(escapeXml(`<script>&"'`)).toBe('&lt;script&gt;&amp;&quot;&apos;');
  });

  it('construit une tuile data-URI utilisable en background-image', () => {
    const url = watermarkTileUrl('Client X — 2026');
    expect(url.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(url).toContain(encodeURIComponent('Client X — 2026'));
  });

  it('neutralise une tentative d’injection dans le SVG', () => {
    const url = watermarkTileUrl(`</text><script>alert(1)</script>`);
    expect(url).not.toContain(encodeURIComponent('<script>'));
  });
});
