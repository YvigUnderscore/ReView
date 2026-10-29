// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { isCheckbox, isSeparator, isSubmenu, separator, tidyMenu, type MenuEntry } from './menuSpec';

const action = (id: string): MenuEntry => ({ id, label: id, onSelect: vi.fn() });
/** Readable summary: the label of an action, `|` for a separator. */
const shape = (entries: MenuEntry[]) => entries.map((e) => (isSeparator(e) ? '|' : e.id));
const ids = (entries: MenuEntry[]) => entries.map((e) => e.id);

describe('tidyMenu', () => {
  it('leaves a clean list intact', () => {
    const entries = [action('a'), separator('s1'), action('b')];
    expect(shape(tidyMenu(entries))).toEqual(['a', '|', 'b']);
  });

  it('removes the leading separator', () => {
    expect(shape(tidyMenu([separator('s'), action('a')]))).toEqual(['a']);
  });

  it('removes the trailing separator', () => {
    expect(shape(tidyMenu([action('a'), separator('s')]))).toEqual(['a']);
  });

  it('merges consecutive separators — case of an action hidden by permissions', () => {
    const entries = [action('a'), separator('s1'), separator('s2'), action('b')];
    expect(shape(tidyMenu(entries))).toEqual(['a', '|', 'b']);
  });

  it('derives the separator identifier from the entry it precedes', () => {
    expect(separator('statut').id).toBe('statut-separator');
  });

  it('returns an empty list when there are only separators', () => {
    expect(tidyMenu([separator('s1'), separator('s2')])).toEqual([]);
  });

  it('drops an empty submenu', () => {
    const entries: MenuEntry[] = [action('a'), { kind: 'submenu', id: 'sub', label: 'Statut', items: [] }];
    expect(ids(tidyMenu(entries))).toEqual(['a']);
  });

  it('cleans the inside of a submenu', () => {
    const entries: MenuEntry[] = [
      { kind: 'submenu', id: 'sub', label: 'Statut', items: [separator('x'), action('todo')] },
    ];
    const [sub] = tidyMenu(entries);
    expect(isSubmenu(sub) && ids(sub.items)).toEqual(['todo']);
  });

  it('does not alter the original list', () => {
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
  it('tells apart the families of entries', () => {
    expect(isSeparator(separator('s'))).toBe(true);
    expect(isSeparator(action('a'))).toBe(false);
    expect(isSubmenu({ kind: 'submenu', id: 'x', label: 'x', items: [] })).toBe(true);
    expect(isSubmenu(action('a'))).toBe(false);
    expect(isCheckbox(checkbox(true))).toBe(true);
    expect(isCheckbox(action('a'))).toBe(false);
  });
});

describe('tidyMenu and checkboxes', () => {
  it('keeps an unticked checkbox, which is a state and not an empty entry', () => {
    // The trap of the empty radio group: an unticked checkbox has nothing to do with a submenu
    // without content; dropping it would remove the only way to set the plan on mount.
    expect(ids(tidyMenu([checkbox(false)]))).toEqual(['omitted']);
    expect(ids(tidyMenu([checkbox(true)]))).toEqual(['omitted']);
  });

  it('keeps a submenu that contains only a checkbox', () => {
    const tidy = tidyMenu([{ kind: 'submenu', id: 'cut', label: 'Montage', items: [checkbox(false)] }]);
    expect(isSubmenu(tidy[0]) && ids(tidy[0].items)).toEqual(['omitted']);
  });
});

describe('tidyMenu and radio groups', () => {
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

  it('keeps a submenu that contains only a filled group', () => {
    // This is exactly the "Status" menu: without dedicated handling, the group counted for nothing
    // and its submenu was dropped although it was full.
    const tidy = tidyMenu([{ kind: 'submenu', id: 'status', label: 'Status', items: [group(3)] }]);
    expect(tidy).toHaveLength(1);
    expect(isSubmenu(tidy[0]) && tidy[0].items).toHaveLength(1);
  });

  it('drops an empty group, and the submenu that contained only it', () => {
    const tidy = tidyMenu([
      { id: 'open', label: 'Open', onSelect: () => {} },
      separator('status'),
      { kind: 'submenu', id: 'status', label: 'Status', items: [group(0)] },
    ]);
    // The separator left alone at the end goes with it.
    expect(tidy.map((e) => e.id)).toEqual(['open']);
  });
});
