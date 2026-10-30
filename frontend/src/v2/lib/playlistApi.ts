// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import type { PlaylistDetail, PlaylistSummary } from '../types/api';

/**
 * Playlists (C5) — client side.
 *
 * The candidate catalogue was the missing piece: no reusable entity search existed, and building a
 * dailies playlist meant opening each shot one by one to click "add".
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
    // The catalogue is a selection aid: refreshing it on every keystroke brings nothing,
    // and the query is already re-run when the filters change.
    staleTime: 30_000,
  });
}

/**
 * Latest published version of each shot in a sequence — the material of a dailies playlist.
 * Direct call rather than a hook: the sequence page only needs it on click.
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

/** Invalidates the playlist and the list that contains it — the item counter depends on it. */
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

/**
 * Removing, reordering and renaming no longer live here: all three are undoable, and their undo is
 * inseparable from the write — see `pages/playlist/usePlaylistUndo`. Three bare mutations lingered
 * alongside, that nobody called any more.
 */
