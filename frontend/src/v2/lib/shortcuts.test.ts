// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { isEditable } from './shortcuts';

const input = (type: string) => {
  const el = document.createElement('input');
  el.type = type;
  return el;
};

describe('isEditable', () => {
  it('bloque les raccourcis dans les champs de saisie de texte', () => {
    expect(isEditable(input('text'))).toBe(true);
    expect(isEditable(input('password'))).toBe(true);
    expect(isEditable(input('number'))).toBe(true);
    expect(isEditable(document.createElement('textarea'))).toBe(true);
    expect(isEditable(document.createElement('select'))).toBe(true);
  });

  it('laisse passer les raccourcis depuis les contrôles non textuels (checkbox du HUD…)', () => {
    expect(isEditable(input('checkbox'))).toBe(false);
    expect(isEditable(input('radio'))).toBe(false);
    expect(isEditable(input('range'))).toBe(false);
    expect(isEditable(document.createElement('button'))).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
});
