// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';

/**
 * Local history of the most recently visited entities (sidebar "Recents").
 * Persisted in localStorage, capped at 5 entries, deduplicated by `key`.
 * Fed by EntityBreadcrumb (the only place where each page's context is resolved).
 */

export type RecentType = 'project' | 'sequence' | 'shot' | 'asset' | 'task' | 'version' | 'media';

export interface RecentEntry {
  key: string; // e.g. "media:12" or "project:3:Kanban"
  type: RecentType;
  label: string;
  sublabel?: string; // name of the parent project (absent if the entry IS a project)
  to: string; // exact URL of the visited page (pathname + search)
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

/** Strips ephemeral session parameters: a recent entry must not rejoin a live session (33.B). */
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

/** Module-level helper (callable outside a component, stable reference). */
export const trackRecent = (entry: Omit<RecentEntry, 'at'>): void => useRecents.getState().push(entry);
