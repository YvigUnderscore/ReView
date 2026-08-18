// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { isSeparator, isSubmenu, separator, tidyMenu, type MenuEntry } from './menuSpec';

const action = (id: string): MenuEntry => ({ id, label: id, onSelect: vi.fn() });
/** Résumé lisible : le libellé d'une action, `|` pour un séparateur. */
const shape = (entries: MenuEntry[]) => entries.map((e) => (isSeparator(e) ? '|' : e.id));
const ids = (entries: MenuEntry[]) => entries.map((e) => e.id);

describe('tidyMenu', () => {
  it('laisse une liste propre intacte', () => {
    const entries = [action('a'), separator('s1'), action('b')];
    expect(shape(tidyMenu(entries))).toEqual(['a', '|', 'b']);
  });

  it('retire le séparateur de tête', () => {
    expect(shape(tidyMenu([separator('s'), action('a')]))).toEqual(['a']);
  });

  it('retire le séparateur de queue', () => {
    expect(shape(tidyMenu([action('a'), separator('s')]))).toEqual(['a']);
  });

  it('fond les séparateurs consécutifs — cas d’une action masquée par les droits', () => {
    const entries = [action('a'), separator('s1'), separator('s2'), action('b')];
    expect(shape(tidyMenu(entries))).toEqual(['a', '|', 'b']);
  });

  it('dérive l’identifiant du séparateur de l’entrée qu’il précède', () => {
    expect(separator('statut').id).toBe('statut-separator');
  });

  it('rend une liste vide sur des séparateurs seuls', () => {
    expect(tidyMenu([separator('s1'), separator('s2')])).toEqual([]);
  });

  it('laisse tomber un sous-menu vide', () => {
    const entries: MenuEntry[] = [action('a'), { kind: 'submenu', id: 'sub', label: 'Statut', items: [] }];
    expect(ids(tidyMenu(entries))).toEqual(['a']);
  });

  it('nettoie l’intérieur d’un sous-menu', () => {
    const entries: MenuEntry[] = [
      { kind: 'submenu', id: 'sub', label: 'Statut', items: [separator('x'), action('todo')] },
    ];
    const [sub] = tidyMenu(entries);
    expect(isSubmenu(sub) && ids(sub.items)).toEqual(['todo']);
  });

  it('n’altère pas la liste d’origine', () => {
    const entries = [separator('s'), action('a')];
    tidyMenu(entries);
    expect(ids(entries)).toEqual(['s-separator', 'a']);
  });
});

describe('discriminants', () => {
  it('distingue les trois familles d’entrées', () => {
    expect(isSeparator(separator('s'))).toBe(true);
    expect(isSeparator(action('a'))).toBe(false);
    expect(isSubmenu({ kind: 'submenu', id: 'x', label: 'x', items: [] })).toBe(true);
    expect(isSubmenu(action('a'))).toBe(false);
  });
});
