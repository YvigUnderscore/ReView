// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import type { EpisodeDetail, EpisodeSettings, EpisodeSummary, EpisodeSequence } from '../types/episode';

/**
 * Accès au niveau Épisode.
 *
 * Le réglage du projet pilote tout : `useEpisodeSettings` est la seule requête qu'un
 * écran lance sans condition, et rien d'autre ne part tant qu'elle répond « éteint ».
 * C'est ce qui garantit qu'un projet de long-métrage ne demande jamais d'épisode au
 * serveur — et n'en montre donc aucune trace.
 *
 * Les clés vivent dans `qk` (`lib/query.ts`) comme toutes les autres.
 */

export interface EpisodeListData {
  episodes: EpisodeSummary[];
  /** Séquences du projet qu'aucun épisode ne réclame — un découpage en cours en laisse. */
  unassignedSequences: number;
  total: number;
}

/**
 * Le réglage du projet. Servi même quand le niveau est éteint : c'est sa réponse qui
 * dit aux écrans de ne rien montrer.
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

/** Vrai seulement quand le serveur l'a confirmé — jamais pendant le chargement. */
export function useEpisodesEnabled(projectId: number): boolean {
  return useEpisodeSettings(projectId).data?.enabled ?? false;
}

/** Les épisodes du projet. Ne part pas tant que le niveau n'est pas confirmé actif. */
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

/** Hook d'invalidation : une mutation d'épisode touche la liste, la fiche et le réglage. */
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

// ───────────────────────────── Écritures ─────────────────────────────

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

// ───────────────────────────── Règles pures ─────────────────────────────

/**
 * Nouvel ordre après un déplacement d'un cran. Rendue pure pour être testée seule : le
 * réordonnancement est la seule interaction du niveau qu'une erreur d'index rendrait
 * silencieusement fausse — la liste se réafficherait, dans le mauvais ordre.
 *
 * Un déplacement hors des bornes rend la liste inchangée plutôt que de la tronquer.
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
 * Répartit les séquences d'un projet par épisode, en gardant l'ordre reçu.
 *
 * Les séquences hors épisode forment un groupe à part entière — « sans » est une réponse,
 * pas une absence : les taire ferait disparaître de l'écran des séquences bien vivantes.
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

/** Les plans d'une séquence donnée dans la fiche d'un épisode, ordre serveur conservé. */
export function shotsOfSequence<T extends { sequenceId: number | null }>(
  shots: T[],
  sequence: Pick<EpisodeSequence, 'id'>,
): T[] {
  return shots.filter((s) => s.sequenceId === sequence.id);
}
