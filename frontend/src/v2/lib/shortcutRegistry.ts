// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Registry of **global** keyboard shortcuts (42.A2) — single source of truth for the
 * handler (`useGlobalShortcuts`) and the cheatsheet (`ShortcutsHelp`), which used to duplicate the list.
 *
 * Model: either a "leader" sequence (the `g` key then one key), or a single key. Only the **second**
 * key (leader) or the single key is reconfigurable; the `g` leader stays fixed. Overrides are persisted
 * on the account in `preferences.shortcuts`.
 */
import type { MessageKey } from '../i18n';

export type ShortcutId = 'nav.projects' | 'nav.kanban' | 'nav.board' | 'help';

export interface ShortcutDef {
  id: ShortcutId;
  /** Translation key of the label, resolved at render time (the registry is stateless). */
  labelKey: MessageKey;
  /** `leader-g`: `g` then the key; `single`: a single key. */
  kind: 'leader-g' | 'single';
  /** Default key (a single character). */
  defaultKey: string;
  /** The action only makes sense within a project (kanban/board). */
  requiresProject?: boolean;
}

export const GLOBAL_SHORTCUTS: readonly ShortcutDef[] = [
  { id: 'nav.projects', labelKey: 'shortcuts.goProjects', kind: 'leader-g', defaultKey: 'p' },
  {
    id: 'nav.kanban',
    labelKey: 'palette.goto.kanban',
    kind: 'leader-g',
    defaultKey: 'k',
    requiresProject: true,
  },
  {
    id: 'nav.board',
    labelKey: 'palette.goto.board',
    kind: 'leader-g',
    defaultKey: 'b',
    requiresProject: true,
  },
  { id: 'help', labelKey: 'shortcuts.showHelp', kind: 'single', defaultKey: '?' },
];

/** A valid override key = exactly one character, and never the `g` leader. */
export function isValidKey(key: string): boolean {
  return key.length === 1 && key.toLowerCase() !== 'g';
}

/**
 * Resolves the active keys by merging the defaults with the account's overrides.
 * An invalid override (empty, multi-character, `g`) is ignored → falls back to the default.
 */
export function resolveBindings(overrides?: Record<string, string>): Record<ShortcutId, string> {
  const out = {} as Record<ShortcutId, string>;
  for (const s of GLOBAL_SHORTCUTS) {
    const o = overrides?.[s.id];
    out[s.id] = o && isValidKey(o) ? o : s.defaultKey;
  }
  return out;
}
