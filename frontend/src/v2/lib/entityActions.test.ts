// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { actionTarget, isBulkTarget, scopedLabel } from './entityActions';

describe('actionTarget', () => {
  it('applies to the whole selection when the clicked card is part of it', () => {
    expect(actionTarget(2, [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('applies to the clicked card alone when it is outside the selection', () => {
    expect(actionTarget(9, [1, 2, 3])).toEqual([9]);
  });

  it('applies to the card alone when there is no selection', () => {
    expect(actionTarget(4, [])).toEqual([4]);
  });

  it('does not switch to grouped for a selection of a single item', () => {
    expect(actionTarget(4, [4])).toEqual([4]);
  });

  it('returns a copy, not the selection itself', () => {
    const selection = [1, 2];
    const target = actionTarget(1, selection);
    target.push(99);
    expect(selection).toEqual([1, 2]);
  });
});

describe('isBulkTarget', () => {
  it('announces grouped only when several items are targeted', () => {
    expect(isBulkTarget(2, [1, 2, 3])).toBe(true);
    expect(isBulkTarget(9, [1, 2, 3])).toBe(false);
    expect(isBulkTarget(1, [1])).toBe(false);
    expect(isBulkTarget(1, [])).toBe(false);
  });
});

describe('scopedLabel', () => {
  const countLabel = (n: number) => `${n} éléments sélectionnés`;

  it('leaves the label bare for a single item', () => {
    expect(scopedLabel('Supprimer', 1, countLabel)).toBe('Supprimer');
    expect(scopedLabel('Supprimer', 0, countLabel)).toBe('Supprimer');
  });

  it('announces the scope beyond a single item', () => {
    expect(scopedLabel('Supprimer', 3, countLabel)).toBe('Supprimer — 3 éléments sélectionnés');
  });
});
