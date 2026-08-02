// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo } from 'react';
import { usePreferences, useUpdatePreferences } from './usePreferences';
import type { SavedView } from '../types/preferences';

/**
 * Vues de liste sauvegardées (42.A5 — №73) : jeux de filtres nommés, persistés par compte
 * dans `preferences.savedViews[scope]`. Réutilisable sur n'importe quelle liste filtrable.
 */

/** Enlève les filtres vides (« » = pas de filtre) pour une comparaison/stockage stables. */
export function normalizeFilters(filters: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(filters)) if (v) out[k] = v;
  return out;
}

/** Deux jeux de filtres sont-ils équivalents (mêmes clés non vides / mêmes valeurs) ? */
export function filtersEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const na = normalizeFilters(a);
  const nb = normalizeFilters(b);
  const ka = Object.keys(na);
  if (ka.length !== Object.keys(nb).length) return false;
  return ka.every((k) => na[k] === nb[k]);
}

/** Ajoute ou remplace (par nom, insensible à la casse/espaces) une vue. */
export function upsertView(views: SavedView[], name: string, filters: Record<string, string>): SavedView[] {
  const trimmed = name.trim();
  const norm = normalizeFilters(filters);
  const idx = views.findIndex((v) => v.name.trim().toLowerCase() === trimmed.toLowerCase());
  const view: SavedView = { id: idx >= 0 ? views[idx]!.id : `v${Date.now()}`, name: trimmed, filters: norm };
  if (idx >= 0) {
    const next = views.slice();
    next[idx] = view;
    return next;
  }
  return [...views, view];
}

export function removeView(views: SavedView[], id: string): SavedView[] {
  return views.filter((v) => v.id !== id);
}

export function useSavedViews(scope: string) {
  const prefsQ = usePreferences();
  const update = useUpdatePreferences();
  const all = useMemo(() => prefsQ.data?.savedViews ?? {}, [prefsQ.data?.savedViews]);
  const views = useMemo(() => all[scope] ?? [], [all, scope]);

  const persist = (nextViews: SavedView[]) => update.mutate({ savedViews: { ...all, [scope]: nextViews } });

  return {
    views,
    save: (name: string, filters: Record<string, string>) => persist(upsertView(views, name, filters)),
    remove: (id: string) => persist(removeView(views, id)),
    saving: update.isPending,
  };
}
