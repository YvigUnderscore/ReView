// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import type { EpisodeDetail, EpisodeSettings, EpisodeSummary, EpisodeSequence } from '../types/episode';

/**
 * Access to the Episode level.
 *
 * The project setting drives everything: `useEpisodeSettings` is the only request a screen fires
 * unconditionally, and nothing else goes out while it answers "off". This is what guarantees that a
 * feature-film project never asks the server for an episode — and therefore shows no trace of one.
 *
 * The keys live in `qk` (`lib/query.ts`) like all the others.
 */

export interface EpisodeListData {
  episodes: EpisodeSummary[];
  /** Project sequences that no episode claims — a split in progress leaves some. */
  unassignedSequences: number;
  total: number;
}

/**
 * The project setting. Served even when the level is off: its answer is what tells the screens to
 * show nothing.
 */
export function useEpisodeSettings(projectId: number, enabled = true) {
  return useQuery({
    queryKey: qk.episodeSettings(projectId),
    queryFn: () =>
      api
        .get<{ settings: EpisodeSettings }>(`/api/episodes/settings?projectId=${projectId}`)
        .then((d) => d.settings),
    enabled: enabled && projectId > 0,
    staleTime: 5 * 60 * 1000,
  });
}

/** True only when the server has confirmed it — never during loading. */
export function useEpisodesEnabled(projectId: number): boolean {
  return useEpisodeSettings(projectId).data?.enabled ?? false;
}

/** The project's episodes. Does not go out until the level is confirmed active. */
export function useEpisodesQuery(projectId: number, enabled = true) {
  return useQuery({
    queryKey: qk.episodes(projectId),
    queryFn: () => api.get<EpisodeListData>(`/api/episodes?projectId=${projectId}&pageSize=500`),
    enabled: enabled && projectId > 0,
  });
}

export function useEpisodeQuery(episodeId: number) {
  return useQuery({
    queryKey: qk.episode(episodeId),
    queryFn: () => api.get<{ episode: EpisodeDetail }>(`/api/episodes/${episodeId}`).then((d) => d.episode),
    enabled: Number.isFinite(episodeId) && episodeId > 0,
  });
}

/** Invalidation hook: an episode mutation touches the list, the record and the setting. */
export function useEpisodeInvalidate(projectId: number) {
  const qc = useQueryClient();
  return (episodeId?: number) => invalidateEpisodes(qc, projectId, episodeId);
}

export async function invalidateEpisodes(
  qc: QueryClient,
  projectId: number,
  episodeId?: number,
): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({ queryKey: qk.episodes(projectId) }),
    qc.invalidateQueries({ queryKey: qk.episodeSettings(projectId) }),
    ...(episodeId ? [qc.invalidateQueries({ queryKey: qk.episode(episodeId) })] : []),
  ]);
}

// ───────────────────────────── Writes ─────────────────────────────

export const setEpisodesEnabled = (projectId: number, enabled: boolean) =>
  api.put<{ settings: EpisodeSettings }>('/api/episodes/settings', { projectId, enabled });

export const createEpisodes = (projectId: number, items: { code: string; name: string }[]) =>
  api.post('/api/episodes/bulk', { projectId, items });

export const reorderEpisodes = (projectId: number, ids: number[]) =>
  api.post('/api/episodes/reorder', { projectId, ids });

export const assignSequencesToEpisode = (
  projectId: number,
  episodeId: number | null,
  sequenceIds: number[],
) => api.post<{ count: number }>('/api/episodes/assign', { projectId, episodeId, sequenceIds });

export const trashEpisode = (id: number) => api.del(`/api/episodes/${id}`);

// ───────────────────────────── Pure rules ─────────────────────────────

/**
 * New order after a one-step move. Made pure so it can be tested on its own: reordering is the only
 * interaction of the level that an index error would silently make wrong — the list would redisplay,
 * in the wrong order.
 *
 * A move outside the bounds returns the list unchanged rather than truncating it.
 */
export function moveInOrder<T extends { id: number }>(items: T[], id: number, delta: number): number[] {
  const ids = items.map((i) => i.id);
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

/**
 * Distributes a project's sequences by episode, keeping the order received.
 *
 * Sequences outside any episode form a group in its own right — "none" is an answer, not an absence:
 * hiding them would make live sequences disappear from the screen.
 */
export function groupSequencesByEpisode<S extends { episodeId?: number | null }>(
  episodes: { id: number }[],
  sequences: S[],
): { episodeId: number | null; sequences: S[] }[] {
  const groups: { episodeId: number | null; sequences: S[] }[] = episodes.map((e) => ({
    episodeId: e.id,
    sequences: sequences.filter((s) => s.episodeId === e.id),
  }));
  groups.push({
    episodeId: null,
    sequences: sequences.filter((s) => s.episodeId === null || s.episodeId === undefined),
  });
  return groups;
}

/** The shots of a given sequence in an episode's record, server order preserved. */
export function shotsOfSequence<T extends { sequenceId: number | null }>(
  shots: T[],
  sequence: Pick<EpisodeSequence, 'id'>,
): T[] {
  return shots.filter((s) => s.sequenceId === sequence.id);
}
