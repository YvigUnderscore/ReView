import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';

/**
 * Hooks Query partagés entre plusieurs composants (une clé = une shape).
 * Les queries propres à une seule page restent définies dans la page.
 */

export interface ProjectSummary {
  id: number;
  name: string;
  description: string | null;
  status: string;
  thumbnailUrl: string | null;
}
export interface SequenceSummary { id: number; name: string; code: string; order: number; _count: { shots: number } }
export interface ShotSummary {
  id: number; name: string; code: string; sequenceId: number | null;
  thumbnailUrl?: string | null; _count?: { tasks: number }; assets?: { id: number; name: string; type: string }[];
}
export interface AssetSummary { id: number; name: string; type: string; thumbnailUrl?: string | null }

/** Liste des projets accessibles — partagée Shell / ProjectsPage / DocumentationPage. */
export function useProjectsQuery() {
  return useQuery({
    queryKey: qk.projects,
    queryFn: () => api.get<{ projects: ProjectSummary[] }>('/api/projects').then((d) => d.projects),
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
    queryFn: () => api.get<{ assets: AssetSummary[] }>(`/api/assets?projectId=${projectId}`).then((d) => d.assets),
    enabled,
  });
}
