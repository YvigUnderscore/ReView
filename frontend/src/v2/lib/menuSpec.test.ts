// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { isCheckbox, isSeparator, isSubmenu, separator, tidyMenu, type MenuEntry } from './menuSpec';

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

const checkbox = (checked: boolean): MenuEntry => ({
  kind: 'checkbox',
  id: 'omitted',
  label: 'Omis du montage',
  checked,
  onCheckedChange: vi.fn(),
});

describe('discriminants', () => {
  it('distingue les familles d’entrées', () => {
    expect(isSeparator(separator('s'))).toBe(true);
    expect(isSeparator(action('a'))).toBe(false);
    expect(isSubmenu({ kind: 'submenu', id: 'x', label: 'x', items: [] })).toBe(true);
    expect(isSubmenu(action('a'))).toBe(false);
    expect(isCheckbox(checkbox(true))).toBe(true);
    expect(isCheckbox(action('a'))).toBe(false);
  });
});

describe('tidyMenu et les cases à cocher', () => {
  it('garde une case décochée, qui vaut un état et non une entrée vide', () => {
    // Le piège du groupe radio vide : une case décochée n'a rien à voir avec un sous-menu
    // sans contenu, la jeter ferait disparaître le seul moyen de remettre le plan au montage.
    expect(ids(tidyMenu([checkbox(false)]))).toEqual(['omitted']);
    expect(ids(tidyMenu([checkbox(true)]))).toEqual(['omitted']);
  });

  it('garde un sous-menu qui ne contient qu’une case', () => {
    const tidy = tidyMenu([{ kind: 'submenu', id: 'cut', label: 'Montage', items: [checkbox(false)] }]);
    expect(isSubmenu(tidy[0]) && ids(tidy[0].items)).toEqual(['omitted']);
  });
});

describe('tidyMenu et les groupes radio', () => {
  const group = (items: number) => ({
    kind: 'radiogroup' as const,
    id: 'status-group',
    value: 'none',
    onValueChange: () => {},
    items: Array.from({ length: items }, (_, i) => ({
      id: `s-${i}`,
      value: String(i),
      label: `S${i}`,
    })),
  });

  it('garde un sous-menu qui ne contient qu’un groupe rempli', () => {
    // C'est exactement le menu « Statut » : sans traitement dédié, le groupe ne comptait
    // pour rien et son sous-menu était jeté alors qu'il était plein.
    const tidy = tidyMenu([{ kind: 'submenu', id: 'status', label: 'Status', items: [group(3)] }]);
    expect(tidy).toHaveLength(1);
    expect(isSubmenu(tidy[0]) && tidy[0].items).toHaveLength(1);
  });

  it('jette un groupe vide, et le sous-menu qui ne contenait que lui', () => {
    const tidy = tidyMenu([
      { id: 'open', label: 'Open', onSelect: () => {} },
      separator('status'),
      { kind: 'submenu', id: 'status', label: 'Status', items: [group(0)] },
    ]);
    // Le séparateur laissé seul en queue part avec.
    expect(tidy.map((e) => e.id)).toEqual(['open']);
  });
});
