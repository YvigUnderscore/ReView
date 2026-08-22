// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { api, getToken } from '../../lib/apiClient';
import { t } from '../i18n';
import type { AssetRef, MediaKind, ProjectRef, SequenceRef, ShotRef, Task } from '../types/api';

/**
 * Recherche globale (palette Ctrl+K) — dix familles de résultats servies par `GET /api/search`.
 *
 * L'appel a son propre client, pour une seule raison : **il doit pouvoir être annulé**. La
 * palette interroge à chaque frappe débouncée ; sans `AbortSignal`, une requête lente sur
 * « SH » continue d'occuper la connexion pendant que l'on tape « SH0120 ». `api.get` n'expose
 * pas de signal (il porte, lui, le renouvellement de session), d'où le chemin rapide ici et
 * le repli sur le client partagé au premier 401 — la mécanique de refresh n'est pas dupliquée.
 */

export interface SearchResults {
  projects: ProjectRef[];
  sequences: (SequenceRef & { projectId: number })[];
  shots: (ShotRef & { projectId: number })[];
  assets: (AssetRef & { projectId: number })[];
  tasks: (Pick<Task, 'id' | 'name' | 'type'> & { shotId: number | null; assetId: number | null })[];
  versions: {
    id: number;
    name: string;
    mediaId: number | null;
    taskId: number | null;
    assetId: number | null;
    context: string;
  }[];
  media: { id: number; name: string; kind: MediaKind; context: string }[];
  playlists: { id: number; name: string; projectName: string }[];
  comments: {
    id: number;
    mediaObjectId: number;
    excerpt: string;
    authorName: string | null;
    createdAt: string;
    context: string;
  }[];
  people: { id: number; name: string | null; jobTitle: string | null }[];
}

export const EMPTY_SEARCH: SearchResults = {
  projects: [],
  sequences: [],
  shots: [],
  assets: [],
  tasks: [],
  versions: [],
  media: [],
  playlists: [],
  comments: [],
  people: [],
};

/** Y a-t-il quoi que ce soit à afficher ? */
export const hasSearchResults = (r: SearchResults): boolean =>
  Object.values(r).some((list) => list.length > 0);

/** Longueur minimale interrogée — un caractère ne discrimine rien (le serveur la refuse). */
export const MIN_SEARCH_LENGTH = 2;

export async function fetchSearch(q: string, signal?: AbortSignal): Promise<SearchResults> {
  const path = `/api/search?q=${encodeURIComponent(q)}`;
  const token = getToken();
  const res = await fetch(path, {
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401) return api.get<SearchResults>(path);
  if (!res.ok) throw new Error(t('common.error.http', { status: res.status }));
  return (await res.json()) as SearchResults;
}
