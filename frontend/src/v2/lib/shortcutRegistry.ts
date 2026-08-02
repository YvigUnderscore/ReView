// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Registre des raccourcis clavier **globaux** (42.A2) — source de vérité unique pour le
 * handler (`useGlobalShortcuts`) et le cheatsheet (`ShortcutsHelp`), qui dupliquaient la liste.
 *
 * Modèle : soit une séquence « leader » (touche `g` puis une touche), soit une touche seule.
 * Seule la **seconde** touche (leader) ou la touche seule est reconfigurable ; le leader `g`
 * reste fixe. Les surcharges sont persistées côté compte dans `preferences.shortcuts`.
 */
export type ShortcutId = 'nav.projects' | 'nav.kanban' | 'nav.board' | 'help';

export interface ShortcutDef {
  id: ShortcutId;
  label: string;
  /** `leader-g` : `g` puis la touche ; `single` : touche seule. */
  kind: 'leader-g' | 'single';
  /** Touche par défaut (un seul caractère). */
  defaultKey: string;
  /** L'action n'a de sens que dans un projet (kanban/board). */
  requiresProject?: boolean;
}

export const GLOBAL_SHORTCUTS: readonly ShortcutDef[] = [
  { id: 'nav.projects', label: 'Aller aux projets', kind: 'leader-g', defaultKey: 'p' },
  {
    id: 'nav.kanban',
    label: 'Kanban du projet courant',
    kind: 'leader-g',
    defaultKey: 'k',
    requiresProject: true,
  },
  {
    id: 'nav.board',
    label: 'Board du projet courant',
    kind: 'leader-g',
    defaultKey: 'b',
    requiresProject: true,
  },
  { id: 'help', label: 'Afficher les raccourcis', kind: 'single', defaultKey: '?' },
];

/** Une touche de surcharge valide = exactement un caractère, et jamais le leader `g`. */
export function isValidKey(key: string): boolean {
  return key.length === 1 && key.toLowerCase() !== 'g';
}

/**
 * Résout les touches actives en fusionnant les défauts avec les surcharges du compte.
 * Une surcharge invalide (vide, multi-caractères, `g`) est ignorée → repli sur le défaut.
 */
export function resolveBindings(overrides?: Record<string, string>): Record<ShortcutId, string> {
  const out = {} as Record<ShortcutId, string>;
  for (const s of GLOBAL_SHORTCUTS) {
    const o = overrides?.[s.id];
    out[s.id] = o && isValidKey(o) ? o : s.defaultKey;
  }
  return out;
}
