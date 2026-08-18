// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import type { PlaylistDetail, PlaylistSummary } from '../types/api';

/**
 * Playlists (C5) — côté client.
 *
 * Le catalogue de candidats est la brique qui manquait : il n'existait aucune recherche
 * d'entités réutilisable, et monter une playlist de dailies obligeait à ouvrir chaque plan
 * un par un pour y cliquer « ajouter ».
 */

export interface PlaylistCandidate {
  versionId: number;
  name: string;
  location: string;
  sequenceId: number | null;
  department: string | null;
  createdAt: string;
  reviewStatus: { id: number; name: string; color: string } | null;
  media: { id: number; kind: string; originalName: string; thumbnailUrl: string | null } | null;
}

export interface CandidateFilters {
  q?: string;
  sequenceId?: string;
  department?: string;
  latestOnly?: boolean;
}

export function usePlaylists(projectId: number) {
  return useQuery({
    queryKey: qk.playlists(projectId),
    queryFn: () =>
      api
        .get<{ playlists: PlaylistSummary[] }>(`/api/playlists?projectId=${projectId}`)
        .then((d) => d.playlists),
    enabled: projectId > 0,
  });
}

export function usePlaylist(playlistId: number) {
  return useQuery({
    queryKey: qk.playlist(playlistId),
    queryFn: () =>
      api.get<{ playlist: PlaylistDetail }>(`/api/playlists/${playlistId}`).then((d) => d.playlist),
    enabled: playlistId > 0,
  });
}

export function useCandidates(projectId: number, filters: CandidateFilters) {
  const params = new URLSearchParams({ projectId: String(projectId) });
  if (filters.q) params.set('q', filters.q);
  if (filters.sequenceId) params.set('sequenceId', filters.sequenceId);
  if (filters.department) params.set('department', filters.department);
  if (filters.latestOnly) params.set('latestOnly', 'true');

  return useQuery({
    queryKey: qk.playlistCandidates(projectId, params.toString()),
    queryFn: () =>
      api
        .get<{ candidates: PlaylistCandidate[] }>(`/api/playlists/candidates?${params.toString()}`)
        .then((d) => d.candidates),
    enabled: projectId > 0,
    // Le catalogue est une aide à la sélection : le rafraîchir à chaque frappe n'apporte
    // rien, et la requête est déjà relancée quand les filtres changent.
    staleTime: 30_000,
  });
}

/**
 * Dernière version publiée de chaque plan d'une séquence — la matière d'une playlist de
 * dailies. Appel direct plutôt que hook : la page de séquence n'en a besoin qu'au clic.
 */
export function fetchSequenceCandidates(projectId: number, sequenceId: number): Promise<PlaylistCandidate[]> {
  const params = new URLSearchParams({
    projectId: String(projectId),
    sequenceId: String(sequenceId),
    latestOnly: 'true',
    limit: '300',
  });
  return api
    .get<{ candidates: PlaylistCandidate[] }>(`/api/playlists/candidates?${params.toString()}`)
    .then((d) => d.candidates);
}

/** Invalide la playlist et la liste qui la contient — le compteur d'items en dépend. */
function invalidate(qc: ReturnType<typeof useQueryClient>, playlistId: number, projectId: number) {
  void qc.invalidateQueries({ queryKey: qk.playlist(playlistId) });
  void qc.invalidateQueries({ queryKey: qk.playlists(projectId) });
}

export function useAddToPlaylist(playlistId: number, projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (versionIds: number[]) =>
      api.post<{ added: number; skipped: number }>(`/api/playlists/${playlistId}/items`, { versionIds }),
    onSuccess: () => invalidate(qc, playlistId, projectId),
  });
}

export function useRemoveFromPlaylist(playlistId: number, projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: number) => api.del(`/api/playlists/${playlistId}/items/${itemId}`),
    onSuccess: () => invalidate(qc, playlistId, projectId),
  });
}

export function useReorderPlaylist(playlistId: number, projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemIds: number[]) => api.patch(`/api/playlists/${playlistId}`, { itemIds }),
    onSuccess: () => invalidate(qc, playlistId, projectId),
  });
}

export function useRenamePlaylist(playlistId: number, projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.patch(`/api/playlists/${playlistId}`, { name }),
    onSuccess: () => invalidate(qc, playlistId, projectId),
  });
}
