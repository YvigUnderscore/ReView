// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';

/**
 * Description déclarative d'un menu contextuel (A3).
 *
 * Chaque écran décrivait son menu en JSX, si bien qu'aucun ne proposait tout à fait les
 * mêmes actions et que les sous-menus étaient réécrits à chaque fois. Une entité décrit
 * désormais ses actions comme des données ; le rendu, les styles, l'accessibilité et la
 * règle de multi-sélection sont traités une seule fois.
 */

export interface MenuAction {
  kind?: 'action';
  id: string;
  label: string;
  icon?: ReactNode;
  /** Raccourci affiché en fin de ligne (le menu ne l'écoute pas, il le rappelle). */
  kbd?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Vrai si l'action porte sur une sélection multiple. */
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

/** Un choix parmi plusieurs, dans un groupe. */
export interface MenuRadioItem {
  id: string;
  value: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

/**
 * Sélection unique — le statut d'une entité, typiquement.
 *
 * Une liste d'actions ne dit pas laquelle est en cours : il faut un groupe radio pour
 * que le statut courant soit *coché* plutôt que deviné à la couleur d'une pastille.
 */
export interface MenuRadioGroup {
  kind: 'radiogroup';
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  items: MenuRadioItem[];
}

export type MenuEntry = MenuAction | MenuSubmenu | MenuSeparator | MenuRadioGroup;

/**
 * Séparateur dérivé de l'identifiant de l'entrée qui le suit. Le suffixe est posé ici et
 * non chez l'appelant : un littéral technique dans un fichier JSX est signalé par le
 * contrôle des textes en dur, qui ne peut pas distinguer une clé d'un libellé.
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

/** Une entrée éventuelle devient une liste — évite un `?? []` mal typé chez l'appelant. */
export function entriesOf(...entries: (MenuEntry | null | undefined)[]): MenuEntry[] {
  return entries.filter((e): e is MenuEntry => e != null);
}

/**
 * Nettoie une liste d'entrées avant rendu : retire les séparateurs en tête, en queue et
 * en double, et laisse tomber les sous-menus vides. Sans ça, un menu dont la moitié des
 * actions est masquée par les droits affiche des traits dans le vide.
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
    // Un groupe vide n'a rien à afficher — et son sous-menu doit disparaître avec lui.
    // Traité avant la branche séparateur : le sous-menu « Statut » ne contient que lui,
    // et le compter pour rien le ferait jeter alors qu'il est bien rempli.
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
  /** Sous-menu (choix d'un statut, d'une playlist…). `onClick` est alors ignoré. */
  items?: EntityItemAction[];
  /** Trait de séparation posé avant cette entrée. */
  separatorBefore?: boolean;
}

/**
 * Traduit les actions d'une carte en entrées de menu déclaratives (A3). L'ancien rendu
 * ne savait exprimer qu'une liste plate : ni sous-menu, ni entrée désactivée, ni
 * séparateur — d'où des menus qui ne pouvaient pas proposer « changer le statut ».
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
