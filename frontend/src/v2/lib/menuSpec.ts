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

export type MenuEntry = MenuAction | MenuSubmenu | MenuSeparator;

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
    if (isSeparator(entry)) {
      const previous = kept[kept.length - 1];
      if (!previous || isSeparator(previous)) continue;
    }
    kept.push(entry);
  }
  while (kept.length > 0 && isSeparator(kept[kept.length - 1])) kept.pop();
  return kept;
}
