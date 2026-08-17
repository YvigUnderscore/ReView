// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { findRawColorClasses } from './check-color-tokens.mjs';

const matches = (source) => findRawColorClasses(source).map((o) => o.match);

describe('findRawColorClasses — palette brute', () => {
  it('relève une nuance de palette', () => {
    expect(matches('<div className="bg-blue-500" />')).toEqual(['bg-blue-500']);
  });

  it('relève chaque préfixe porteur de couleur', () => {
    expect(matches('"text-amber-400 border-rose-200 fill-emerald-600"')).toEqual([
      'text-amber-400',
      'border-rose-200',
      'fill-emerald-600',
    ]);
  });

  it("relève la variante d'opacité avec elle", () => {
    expect(matches('"border-rose-200/50"')).toEqual(['border-rose-200/50']);
  });

  it('relève la classe derrière une variante d’état', () => {
    expect(matches('"hover:ring-emerald-600 dark:bg-red-950"')).toEqual(['ring-emerald-600', 'bg-red-950']);
  });

  it('rend la ligne, la colonne et la nature de chaque occurrence', () => {
    const [occ] = findRawColorClasses('const a = 1;\nconst b = "text-sky-300";');
    expect(occ).toEqual({ line: 2, column: 12, match: 'text-sky-300', kind: 'palette' });
  });
});

describe('findRawColorClasses — couleurs arbitraires', () => {
  it('relève un hexadécimal', () => {
    expect(matches('"bg-[#ff0000]"')).toEqual(['bg-[#ff0000]']);
  });

  it('relève rgb, hsl et oklch', () => {
    expect(matches('"text-[rgb(1,2,3)] fill-[hsl(200,50%,50%)] stroke-[oklch(0.7_0.1_200)]"')).toEqual([
      'text-[rgb(1,2,3)]',
      'fill-[hsl(200,50%,50%)]',
      'stroke-[oklch(0.7_0.1_200)]',
    ]);
  });
});

describe('findRawColorClasses — ce qui reste permis', () => {
  it('laisse passer les tokens du thème', () => {
    expect(matches('"bg-primary text-muted-foreground bg-destructive/20 bg-warning"')).toEqual([]);
  });

  it('laisse passer les neutres hors palette', () => {
    expect(matches('"bg-white/50 text-black bg-transparent fill-current text-inherit"')).toEqual([]);
  });

  it('laisse passer les valeurs arbitraires non colorées', () => {
    expect(
      matches('"text-[10px] bg-[image:var(--x)] bg-[var(--panel)] shadow-[0_1px_0_var(--border)]"'),
    ).toEqual([]);
  });
});

describe('findRawColorClasses — faux amis', () => {
  it('ignore un nom de palette employé comme préfixe', () => {
    expect(matches('"sky-blue-500"')).toEqual([]);
  });

  it('ignore un préfixe enfoui dans un mot', () => {
    expect(matches('"subtext-blue-500 x-bg-red-500"')).toEqual([]);
  });

  it('ignore un nombre qui n’est pas une nuance', () => {
    expect(matches('"bg-red-5"')).toEqual([]);
  });

  // Limite assumée du contrôle textuel : le motif exact est signalé où qu'il apparaisse,
  // y compris dans un commentaire — il n'a aucune raison d'exister hors d'une classe.
  it('signale le motif même hors d’un className', () => {
    expect(matches('// ne pas réintroduire bg-blue-500 ici')).toEqual(['bg-blue-500']);
  });
});
