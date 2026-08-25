// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { bestScore, fieldScore, normalise, rankBy } from './searchRank';

describe('normalise', () => {
  it('ignore la casse et les accents — un artiste tape rarement les accents', () => {
    expect(normalise('Héros')).toBe('heros');
    expect(normalise('SH0120')).toBe('sh0120');
  });
});

describe('fieldScore — qualité de la correspondance', () => {
  it('classe du plus net au plus vague', () => {
    const exact = fieldScore('SH0120', 'SH0120', 'code')!;
    const prefix = fieldScore('SH0120_v2', 'SH0120', 'code')!;
    const word = fieldScore('ep01 SH0120', 'SH0120', 'code')!;
    const contains = fieldScore('xSH0120', 'SH0120', 'code')!;
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(contains);
  });

  it('distingue un début de mot d’un fragment au milieu', () => {
    // « pluie » dans « sous la pluie » vaut mieux que dans « parapluie ».
    expect(fieldScore('sous la pluie', 'pluie', 'description')!).toBeGreaterThan(
      fieldScore('parapluie', 'pluie', 'description')!,
    );
  });

  it('ne rend rien quand la valeur ne correspond pas', () => {
    expect(fieldScore('SH0120', 'compositing', 'code')).toBeNull();
    expect(fieldScore(null, 'x', 'code')).toBeNull();
    expect(fieldScore('SH0120', '   ', 'code')).toBeNull();
  });
});

describe('fieldScore — poids du champ', () => {
  it('préfère un code à un nom, et un nom à une description', () => {
    // Trouver « pluie » dans le code d'un plan est plus fort que dans un brief de trente
    // lignes, à qualité de correspondance égale.
    const code = fieldScore('pluie', 'pluie', 'code')!;
    const name = fieldScore('pluie', 'pluie', 'name')!;
    const description = fieldScore('pluie', 'pluie', 'description')!;
    const body = fieldScore('pluie', 'pluie', 'body')!;
    expect(code).toBeGreaterThan(name);
    expect(name).toBeGreaterThan(description);
    expect(description).toBeGreaterThan(body);
  });

  it('une correspondance exacte dans une description bat un fragment dans un code', () => {
    expect(fieldScore('pluie', 'pluie', 'description')!).toBeGreaterThan(
      fieldScore('xpluiex', 'pluie', 'code')!,
    );
  });
});

describe('bestScore', () => {
  it('retient le meilleur champ', () => {
    const score = bestScore('pluie', [
      { value: 'SH0120', field: 'code' },
      { value: 'pluie', field: 'description' },
    ]);
    expect(score).toBe(fieldScore('pluie', 'pluie', 'description'));
  });

  it('rend zéro quand rien ne correspond — le résultat reste, il ne remonte pas', () => {
    expect(bestScore('néant', [{ value: 'SH0120', field: 'code' }])).toBe(0);
  });
});

describe('rankBy', () => {
  it('classe par score décroissant', () => {
    const items = [{ s: 1 }, { s: 9 }, { s: 5 }];
    expect(rankBy(items, (i) => i.s).map((i) => i.s)).toEqual([9, 5, 1]);
  });

  it('préserve l’ordre d’origine à score égal — le plus récent d’abord', () => {
    // L'ordre d'origine vient de la base : entre deux plans qui correspondent aussi bien,
    // celui qui a bougé récemment est celui qu'on cherche.
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(rankBy(items, () => 5).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('ne perd aucun élément', () => {
    const items = [{ s: 0 }, { s: 3 }, { s: 0 }];
    expect(rankBy(items, (i) => i.s)).toHaveLength(3);
  });
});
