// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { actionTarget, isBulkTarget, scopedLabel } from './entityActions';

describe('actionTarget', () => {
  it('porte sur toute la sélection quand la carte cliquée en fait partie', () => {
    expect(actionTarget(2, [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('porte sur la seule carte cliquée quand elle est hors sélection', () => {
    expect(actionTarget(9, [1, 2, 3])).toEqual([9]);
  });

  it('porte sur la seule carte sans sélection', () => {
    expect(actionTarget(4, [])).toEqual([4]);
  });

  it('ne bascule pas en groupé pour une sélection d’un seul élément', () => {
    expect(actionTarget(4, [4])).toEqual([4]);
  });

  it('rend une copie, pas la sélection elle-même', () => {
    const selection = [1, 2];
    const target = actionTarget(1, selection);
    target.push(99);
    expect(selection).toEqual([1, 2]);
  });
});

describe('isBulkTarget', () => {
  it('annonce le groupé seulement quand plusieurs éléments sont visés', () => {
    expect(isBulkTarget(2, [1, 2, 3])).toBe(true);
    expect(isBulkTarget(9, [1, 2, 3])).toBe(false);
    expect(isBulkTarget(1, [1])).toBe(false);
    expect(isBulkTarget(1, [])).toBe(false);
  });
});

describe('scopedLabel', () => {
  const countLabel = (n: number) => `${n} éléments sélectionnés`;

  it('laisse le libellé nu pour un seul élément', () => {
    expect(scopedLabel('Supprimer', 1, countLabel)).toBe('Supprimer');
    expect(scopedLabel('Supprimer', 0, countLabel)).toBe('Supprimer');
  });

  it('annonce la portée au-delà d’un élément', () => {
    expect(scopedLabel('Supprimer', 3, countLabel)).toBe('Supprimer — 3 éléments sélectionnés');
  });
});
