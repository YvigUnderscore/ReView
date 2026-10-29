// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';

/**
 * Declarative description of a context menu (A3).
 *
 * Each screen described its menu in JSX, so none of them offered quite the same actions, and submenus
 * were rewritten every time. An entity now describes its actions as data; rendering, styles,
 * accessibility and the multi-selection rule are handled once.
 */

export interface MenuAction {
  kind?: 'action';
  id: string;
  label: string;
  icon?: ReactNode;
  /** Shortcut shown at the end of the line (the menu does not listen to it, it reminds of it). */
  kbd?: string;
  danger?: boolean;
  disabled?: boolean;
  /** True if the action applies to a multiple selection. */
  onSelect: () => void;
}

export interface MenuSubmenu {
  kind: 'submenu';
  id: string;
  label: string;
  icon?: ReactNode;
  items: MenuEntry[];
}

export interface MenuSeparator {
  kind: 'separator';
  id: string;
}

/**
 * Toggle of an entity state — typically a plan left out of the mount.
 *
 * An ordinary action announces what it is going to do, never where the entity stands: it would take
 * two labels and two icons to suggest a state that the tick states by itself, and the menu would lie
 * while the list refreshes.
 */
export interface MenuCheckbox {
  kind: 'checkbox';
  id: string;
  label: string;
  icon?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/** One choice among several, in a group. */
export interface MenuRadioItem {
  id: string;
  value: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

/**
 * Single selection — typically the status of an entity.
 *
 * A list of actions does not say which one is current: a radio group is needed so that the current
 * status is *ticked* rather than guessed from the colour of a badge.
 */
export interface MenuRadioGroup {
  kind: 'radiogroup';
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  items: MenuRadioItem[];
}

export type MenuEntry = MenuAction | MenuSubmenu | MenuSeparator | MenuRadioGroup | MenuCheckbox;

/**
 * Separator derived from the identifier of the entry that follows it. The suffix is set here and not
 * by the caller: a technical literal in a JSX file is flagged by the hard-coded text check, which
 * cannot tell a key from a label.
 */
export const separator = (id: string): MenuSeparator => ({ kind: 'separator', id: id + SEPARATOR_SUFFIX });

const SEPARATOR_SUFFIX = '-separator';

export function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return entry.kind === 'separator';
}

export function isSubmenu(entry: MenuEntry): entry is MenuSubmenu {
  return entry.kind === 'submenu';
}

export function isRadioGroup(entry: MenuEntry): entry is MenuRadioGroup {
  return entry.kind === 'radiogroup';
}

export function isCheckbox(entry: MenuEntry): entry is MenuCheckbox {
  return entry.kind === 'checkbox';
}

/** An optional entry becomes a list — avoids a badly typed `?? []` on the caller's side. */
export function entriesOf(...entries: (MenuEntry | null | undefined)[]): MenuEntry[] {
  return entries.filter((e): e is MenuEntry => e != null);
}

/**
 * Cleans a list of entries before rendering: removes leading, trailing and duplicate separators, and
 * drops empty submenus. Without that, a menu where half the actions are hidden by permissions would
 * display lines in the void.
 */
export function tidyMenu(entries: MenuEntry[]): MenuEntry[] {
  const kept: MenuEntry[] = [];
  for (const entry of entries) {
    if (isSubmenu(entry)) {
      const items = tidyMenu(entry.items);
      if (items.length === 0) continue;
      kept.push({ ...entry, items });
      continue;
    }
    // An empty group has nothing to display — and its submenu must disappear with it.
    // Handled before the separator branch: the "Status" submenu contains only it, and counting it
    // for nothing would drop it although it is full.
    if (isRadioGroup(entry)) {
      if (entry.items.length === 0) continue;
      kept.push(entry);
      continue;
    }
    if (isSeparator(entry)) {
      const previous = kept[kept.length - 1];
      if (!previous || isSeparator(previous)) continue;
    }
    kept.push(entry);
  }
  while (kept.length > 0 && isSeparator(kept[kept.length - 1])) kept.pop();
  return kept;
}

export interface EntityItemAction {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Submenu (choice of a status, a playlist…). `onClick` is then ignored. */
  items?: EntityItemAction[];
  /** Separator line placed before this entry. */
  separatorBefore?: boolean;
}

/**
 * Translates the actions of a card into declarative menu entries (A3). The former rendering could
 * only express a flat list: no submenu, no disabled entry, no separator — hence menus that could not
 * offer "change the status".
 */
export function toMenuEntries(actions: EntityItemAction[], prefix = 'a'): MenuEntry[] {
  return actions.flatMap((action, index): MenuEntry[] => {
    const id = `${prefix}-${index}-${action.label}`;
    const entry: MenuEntry = action.items
      ? {
          kind: 'submenu',
          id,
          label: action.label,
          icon: action.icon,
          items: toMenuEntries(action.items, id),
        }
      : {
          id,
          label: action.label,
          icon: action.icon,
          danger: action.danger,
          disabled: action.disabled,
          onSelect: () => action.onClick?.(),
        };
    return action.separatorBefore ? [separator(id), entry] : [entry];
  });
}
