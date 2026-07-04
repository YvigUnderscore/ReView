import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import type { Asset, Notification, Project, SequenceSummary, ShotSummary } from '../types/api';

/**
 * Hooks Query partagés entre plusieurs composants (une clé = une shape).
 * Les queries propres à une seule page restent définies dans la page.
 */

/** Liste des projets accessibles — partagée Shell / ProjectsPage / DocumentationPage. */
export function useProjectsQuery() {
  return useQuery({
    queryKey: qk.projects,
    queryFn: () => api.get<{ projects: Project[] }>('/api/projects').then((d) => d.projects),
  });
}

/** Séquences d'un projet (+ compteur de shots hors séquence) — sidebar / ProjectPage / AssetAssignDialog. */
export function useSequencesQuery(projectId: number, enabled = true) {
  return useQuery({
    queryKey: qk.sequences(projectId),
    queryFn: () => api.get<{ sequences: SequenceSummary[]; unsequencedShots: number }>(`/api/sequences?projectId=${projectId}`),
    enabled,
  });
}

/** Shots d'un projet — ProjectPage / KanbanPage / AssetAssignDialog. */
export function useShotsQuery(projectId: number, enabled = true) {
  return useQuery({
    queryKey: qk.shots(projectId),
    queryFn: () => api.get<{ shots: ShotSummary[] }>(`/api/shots?projectId=${projectId}`).then((d) => d.shots),
    enabled,
  });
}

/** Assets d'un projet — sidebar / ProjectPage / ShotDetailDrawer. */
export function useAssetsQuery(projectId: number, enabled = true) {
  return useQuery({
    queryKey: qk.assets(projectId),
    queryFn: () => api.get<{ assets: Asset[] }>(`/api/assets?projectId=${projectId}`).then((d) => d.assets),
    enabled,
  });
}

/** Notifications de l'utilisateur courant (+ compteur non-lus) — cloche topbar (10.C5). */
export interface NotificationsData { notifications: Notification[]; unread: number }
export function useNotificationsQuery(enabled = true) {
  return useQuery({
    queryKey: qk.notifications,
    queryFn: () => api.get<NotificationsData>('/api/notifications'),
    enabled,
  });
}
