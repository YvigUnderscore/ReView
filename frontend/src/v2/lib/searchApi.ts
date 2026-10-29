// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { apiFetch } from './apiFetch';
import { t } from '../i18n';
import type { AssetRef, MediaKind, ProjectRef, SequenceRef, ShotRef, Task } from '../types/api';

/**
 * Global search (Ctrl+K palette) — ten result families served by `GET /api/search`.
 *
 * The call has its own client, for one reason: **it must be cancellable**. The palette queries on every
 * debounced keystroke; without an `AbortSignal`, a slow request for "SH" keeps occupying the connection
 * while "SH0120" is being typed. `api.get` does not expose a signal (it carries the session renewal),
 * hence the fast path here and the fallback to the shared client on the first 401 — the refresh
 * mechanism is not duplicated.
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

/** Is there anything at all to display? */
export const hasSearchResults = (r: SearchResults): boolean =>
  Object.values(r).some((list) => list.length > 0);

/** Minimum queried length — a single character discriminates nothing (the server refuses it). */
export const MIN_SEARCH_LENGTH = 2;

export async function fetchSearch(q: string, signal?: AbortSignal): Promise<SearchResults> {
  const path = `/api/search?q=${encodeURIComponent(q)}`;
  const res = await apiFetch(path, { signal });
  if (!res.ok) throw new Error(t('common.error.http', { status: res.status }));
  return (await res.json()) as SearchResults;
}
