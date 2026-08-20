// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { getSocket } from '../../lib/socket';
import { qk } from './query';
import type {
  AssetListItem,
  LiveSessionSummary,
  Notification,
  Project,
  ReviewStatus,
  SequenceSummary,
  ShotSummary,
} from '../types/api';

/**
 * Hooks Query partagés entre plusieurs composants (une clé = une shape).
 * Les queries propres à une seule page restent définies dans la page.
 */

/** Enveloppe de liste paginée renvoyée par les endpoints bornés (10.D1). */
interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Liste des projets actifs (archivés exclus) — partagée Shell / ProjectsPage. */
export function useProjectsQuery() {
  return useQuery({
    queryKey: qk.projects,
    queryFn: () => api.get<Page<Project>>('/api/projects').then((d) => d.items),
  });
}

/** Projets archivés (38.B) — onglet « Archivés » de ProjectsPage. */
export function useArchivedProjectsQuery(enabled = true) {
  return useQuery({
    queryKey: qk.projectsArchived,
    queryFn: () => api.get<Page<Project>>('/api/projects?archived=1').then((d) => d.items),
    enabled,
  });
}

/** Séquences d'un projet (+ compteur de shots hors séquence) — sidebar / ProjectPage / AssetAssignDialog. */
export function useSequencesQuery(projectId: number, enabled = true) {
  return useQuery({
    queryKey: qk.sequences(projectId),
    queryFn: () =>
      api.get<{ sequences: SequenceSummary[]; unsequencedShots: number }>(
        `/api/sequences?projectId=${projectId}`,
      ),
    enabled,
  });
}

/** Shots d'un projet — ProjectPage / KanbanPage / AssetAssignDialog. */
export function useShotsQuery(projectId: number, enabled = true) {
  return useQuery({
    queryKey: qk.shots(projectId),
    queryFn: () => api.get<Page<ShotSummary>>(`/api/shots?projectId=${projectId}`).then((d) => d.items),
    enabled,
  });
}

/** Assets d'un projet — sidebar / ProjectPage / ShotDetailDrawer. */
export function useAssetsQuery(projectId: number, enabled = true) {
  return useQuery({
    queryKey: qk.assets(projectId),
    queryFn: () => api.get<Page<AssetListItem>>(`/api/assets?projectId=${projectId}`).then((d) => d.items),
    enabled,
  });
}

/** Statuts de review du studio (Phase 31) — badges, filtres, menus de décision. */
/**
 * Statuts de review. Avec un `projectId`, la liste est celle du projet : sur un projet
 * relié à ShotGrid, elle se restreint au vocabulaire du site plutôt que d'empiler les
 * statuts d'origine de ReView et ceux du studio.
 */
export function useReviewStatusesQuery(enabled = true, projectId?: number) {
  return useQuery({
    queryKey: projectId ? [...qk.reviewStatuses, projectId] : qk.reviewStatuses,
    queryFn: () =>
      api
        .get<{ statuses: ReviewStatus[] }>(
          `/api/review-statuses${projectId ? `?projectId=${projectId}` : ''}`,
        )
        .then((d) => d.statuses),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

/** Notifications de l'utilisateur courant (+ compteur non-lus) — cloche topbar (10.C5). */
export interface NotificationsData {
  notifications: Notification[];
  unread: number;
}
export function useNotificationsQuery(enabled = true) {
  return useQuery({
    queryKey: qk.notifications,
    queryFn: () => api.get<NotificationsData>('/api/notifications'),
    enabled,
  });
}

/**
 * Sessions live en cours du projet (badges LIVE — retours 33) : bouton de la review,
 * cartes de version. Rafraîchies par l'event socket `live:changed` (room du projet,
 * rejointe via `join_project` par les pages concernées ou ici même).
 */
export function useLiveSessionsQuery(projectId: number | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (projectId === null) return;
    const socket = getSocket();
    socket.emit('join_project', projectId);
    const onChanged = (data: { projectId: number }) => {
      if (data.projectId === projectId) void qc.invalidateQueries({ queryKey: qk.liveSessions(projectId) });
    };
    socket.on('live:changed', onChanged);
    return () => {
      socket.off('live:changed', onChanged);
      // La salle n'était jamais quittée (D3) : un onglet ouvert la journée finissait par
      // recevoir les événements de tous les projets visités, et invalidait des caches qui
      // ne le concernaient plus.
      socket.emit('leave_project', projectId);
    };
  }, [projectId, qc]);
  return useQuery({
    queryKey: qk.liveSessions(projectId ?? 0),
    queryFn: () =>
      api
        .get<{ sessions: LiveSessionSummary[] }>(`/api/live/sessions?projectId=${projectId}`)
        .then((d) => d.sessions),
    enabled: projectId !== null,
    staleTime: 10_000,
  });
}

/** Config watermark spectateur (35.B) — lue par les viewers internes. */
export function useWatermarkConfigQuery() {
  return useQuery({
    queryKey: qk.watermarkConfig,
    queryFn: () =>
      api
        .get<{ watermark: { internal: boolean; shares: boolean; opacity: number } }>('/api/studio/watermark')
        .then((d) => d.watermark),
    staleTime: 5 * 60 * 1000,
  });
}

/** Tâche proposable comme destination d'une version. */
export interface ProjectTask {
  id: number;
  name: string;
  department: string | null;
  pipelineStatusId: number | null;
  parentKind: 'shot' | 'asset';
  parentName: string;
  versionCount: number;
}

/**
 * Toutes les tâches du projet.
 *
 * Chargées seulement quand on en a besoin — au moment de choisir où ranger une version —
 * et gardées un moment : la liste ne bouge qu'au rythme des synchronisations.
 */
export function useProjectTasks(projectId: number, enabled = true) {
  return useQuery({
    queryKey: qk.projectTasks(projectId),
    queryFn: () =>
      api.get<{ tasks: ProjectTask[] }>(`/api/tasks?projectId=${projectId}`).then((r) => r.tasks),
    enabled: enabled && projectId > 0,
    staleTime: 60_000,
  });
}
