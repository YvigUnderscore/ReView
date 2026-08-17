// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';

/**
 * Historique local des dernières entités visitées (sidebar « Récents »).
 * Persisté en localStorage, borné à 5 entrées, dédupliqué par `key`.
 * Alimenté par EntityBreadcrumb (seul endroit où le contexte de chaque page est résolu).
 */

export type RecentType = 'project' | 'sequence' | 'shot' | 'asset' | 'task' | 'version' | 'media';

export interface RecentEntry {
  key: string; // ex. « media:12 » ou « project:3:Kanban »
  type: RecentType;
  label: string;
  sublabel?: string; // nom du projet parent (absent si l'entrée EST un projet)
  to: string; // URL exacte de la page visitée (pathname + search)
  at: number;
}

const LS_KEY = 'review:recents';
const MAX = 5;

function read(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as RecentEntry[]) : [];
  } catch {
    return [];
  }
}

interface RecentsState {
  recents: RecentEntry[];
  push: (entry: Omit<RecentEntry, 'at'>) => void;
}

/** Retire les paramètres de session éphémères : un récent ne doit pas re-rejoindre un live (33.B). */
const stripEphemeral = (to: string): string => {
  const [path, search] = to.split('?');
  if (!search) return to;
  const params = new URLSearchParams(search);
  params.delete('live');
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
};

export const useRecents = create<RecentsState>((set) => ({
  recents: read(),
  push: (entry) =>
    set((s) => {
      const next = [
        { ...entry, to: stripEphemeral(entry.to), at: Date.now() },
        ...s.recents.filter((r) => r.key !== entry.key),
      ].slice(0, MAX);
      localStorage.setItem(LS_KEY, JSON.stringify(next));
      return { recents: next };
    }),
}));

/** Helper module-level (appelable hors composant, référence stable). */
export const trackRecent = (entry: Omit<RecentEntry, 'at'>): void => useRecents.getState().push(entry);
