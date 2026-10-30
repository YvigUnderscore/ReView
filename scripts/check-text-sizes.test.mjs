// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { findPixelTextSizes } from './check-text-sizes.mjs';

const matches = (source) => findPixelTextSizes(source).map((o) => o.match);

describe('findPixelTextSizes', () => {
  it('reports a font size in pixels', () => {
    expect(matches('<span className="text-[10px]" />')).toEqual(['text-[10px]']);
  });

  it('reports every occurrence on the line', () => {
    expect(matches('"text-[9px] gap-1 text-[11px]"')).toEqual(['text-[9px]', 'text-[11px]']);
  });

  it('also reports point sizes', () => {
    expect(matches('"text-[12pt]"')).toEqual(['text-[12pt]']);
  });

  it('lets the token scale through', () => {
    expect(matches('"text-2xs text-xs text-sm text-base text-lg"')).toEqual([]);
  });

  it('only targets typography, not other arbitrary values', () => {
    expect(matches('"w-[72px] min-w-[1440px] left-[-99999px] h-[calc(100vh-7rem)]"')).toEqual([]);
  });

  it('lets arbitrary colours or variables through', () => {
    expect(matches('"text-[#ff0000] text-[var(--x)]"')).toEqual([]);
  });

  it('reports the line and the column', () => {
    const [found] = findPixelTextSizes('ligne une\n  <p className="text-[10px]">');
    expect(found.line).toBe(2);
    expect(found.column).toBeGreaterThan(1);
  });

  it('reports nothing in a clean source', () => {
    expect(findPixelTextSizes('const a = 1;\n// text de commentaire\n')).toEqual([]);
  });
});
