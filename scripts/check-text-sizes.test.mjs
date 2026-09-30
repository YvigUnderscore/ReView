// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { findPixelTextSizes } from './check-text-sizes.mjs';

const matches = (source) => findPixelTextSizes(source).map((o) => o.match);

describe('findPixelTextSizes', () => {
  it('relève une taille de police en pixels', () => {
    expect(matches('<span className="text-[10px]" />')).toEqual(['text-[10px]']);
  });

  it('relève chaque occurrence de la ligne', () => {
    expect(matches('"text-[9px] gap-1 text-[11px]"')).toEqual(['text-[9px]', 'text-[11px]']);
  });

  it('relève aussi les points typographiques', () => {
    expect(matches('"text-[12pt]"')).toEqual(['text-[12pt]']);
  });

  it('laisse passer la rampe de tokens', () => {
    expect(matches('"text-2xs text-xs text-sm text-base text-lg"')).toEqual([]);
  });

  it('ne vise que la typographie, pas les autres valeurs arbitraires', () => {
    expect(matches('"w-[72px] min-w-[1440px] left-[-99999px] h-[calc(100vh-7rem)]"')).toEqual([]);
  });

  it('laisse passer une couleur ou une variable arbitraires', () => {
    expect(matches('"text-[#ff0000] text-[var(--x)]"')).toEqual([]);
  });

  it('rapporte la ligne et la colonne', () => {
    const [found] = findPixelTextSizes('ligne une\n  <p className="text-[10px]">');
    expect(found.line).toBe(2);
    expect(found.column).toBeGreaterThan(1);
  });

  it('ne relève rien dans une source propre', () => {
    expect(findPixelTextSizes('const a = 1;\n// text de commentaire\n')).toEqual([]);
  });
});
