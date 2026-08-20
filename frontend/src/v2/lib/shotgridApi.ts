// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import type {
  PipelineStatus,
  SgConnection,
  SgDiffReport,
  SgImportableVersion,
  SgRemoteProject,
  SgSettings,
  SgSite,
  SgSyncLog,
  SgSyncRun,
} from '../types/shotgrid';

/** Accès à l'API ShotGrid — clés de cache et mutations, dans la convention `qk.*`. */

export const sgKeys = {
  sites: ['shotgrid', 'sites'] as const,
  remoteProjects: (siteId: number, query: string) =>
    ['shotgrid', 'sites', siteId, 'projects', query] as const,
  connection: (projectId: number) => ['shotgrid', 'connection', projectId] as const,
  runs: (projectId: number) => ['shotgrid', 'runs', projectId] as const,
  logs: (runId: number, level: string) => ['shotgrid', 'logs', runId, level] as const,
  diff: (projectId: number) => ['shotgrid', 'diff', projectId] as const,
  versions: (projectId: number) => ['shotgrid', 'versions', projectId] as const,
  pipelineStatuses: (scope?: string, projectId?: number) =>
    ['pipeline-statuses', scope ?? 'all', projectId ?? 'studio'] as const,
};

// ───────────────────────────── Sites ─────────────────────────────

export function useSgSites(enabled = true) {
  return useQuery({
    queryKey: sgKeys.sites,
    queryFn: () => api.get<{ sites: SgSite[] }>('/api/shotgrid/sites').then((r) => r.sites),
    enabled,
  });
}

export interface SiteFormInput {
  name: string;
  baseUrl: string;
  authMode: 'script' | 'user';
  scriptName?: string | null;
  scriptKey?: string | null;
  login?: string | null;
  password?: string | null;
}

export function useCreateSgSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SiteFormInput) =>
      api.post<{ site: SgSite }>('/api/shotgrid/sites', input).then((r) => r.site),
    onSuccess: () => qc.invalidateQueries({ queryKey: sgKeys.sites }),
  });
}

export function useUpdateSgSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<SiteFormInput> & { id: number }) =>
      api.patch<{ site: SgSite }>(`/api/shotgrid/sites/${id}`, input).then((r) => r.site),
    onSuccess: () => qc.invalidateQueries({ queryKey: sgKeys.sites }),
  });
}

export function useDeleteSgSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/shotgrid/sites/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: sgKeys.sites }),
  });
}

export function useTestSgSite() {
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: boolean; version: string; projectCount: number }>(`/api/shotgrid/sites/${id}/test`),
  });
}

/** Projets du site : c'est cette liste qui sert à désigner la cible par son nom. */
export function useSgRemoteProjects(siteId: number | null, query: string) {
  return useQuery({
    queryKey: sgKeys.remoteProjects(siteId ?? 0, query),
    queryFn: () =>
      api
        .get<{ projects: SgRemoteProject[] }>(
          `/api/shotgrid/sites/${siteId}/projects${query ? `?query=${encodeURIComponent(query)}` : ''}`,
        )
        .then((r) => r.projects),
    enabled: siteId !== null,
  });
}

// ───────────────────────────── Connexion ─────────────────────────────

export function useSgConnection(projectId: number) {
  return useQuery({
    queryKey: sgKeys.connection(projectId),
    queryFn: () =>
      api
        .get<{ connection: SgConnection | null }>(`/api/shotgrid/projects/${projectId}/connection`)
        .then((r) => r.connection),
    // Le projet n'est pas encore connu (une page d'entité le découvre en chargeant son
    // entité) : demander la connexion du projet « 0 » ne peut que rendre une erreur.
    enabled: projectId > 0,
    // Sans connexion, la réponse est `null` : inutile d'y revenir sans cesse.
    staleTime: 30_000,
  });
}

export function useCreateSgConnection(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { siteId: number; sgProjectId: number; sgProjectName: string }) =>
      api
        .post<{ connection: SgConnection }>(`/api/shotgrid/projects/${projectId}/connection`, input)
        .then((r) => r.connection),
    onSuccess: () => qc.invalidateQueries({ queryKey: sgKeys.connection(projectId) }),
  });
}

/** Sections de réglages fusionnées en profondeur — mêmes que côté serveur. */
const MERGED_SECTIONS = ['domains', 'media', 'push', 'reconcile', 'steps'] as const;

type SgPatch = { settings?: Partial<SgSettings>; active?: boolean; webhookSecret?: string | null };

/**
 * Applique le patch au cache exactement comme le serveur l'appliquera : d'un cran en
 * profondeur. Un `setQueryData` plat rejouerait le défaut qu'on corrige côté route.
 */
function applyPatch(current: SgConnection, patch: SgPatch): SgConnection {
  const { settings: received, ...rest } = patch;
  if (!received) return { ...current, ...rest };
  const settings: Record<string, unknown> = { ...current.settings, ...received };
  for (const section of MERGED_SECTIONS) {
    const value = received[section];
    if (value === undefined) continue;
    settings[section] = { ...(current.settings[section] as object), ...(value as object) };
  }
  return { ...current, ...rest, settings: settings as unknown as SgSettings };
}

export function useUpdateSgConnection(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SgPatch) =>
      api
        .patch<{ connection: SgConnection }>(`/api/shotgrid/projects/${projectId}/connection`, patch)
        .then((r) => r.connection),
    /**
     * Mise à jour optimiste — sans elle, deux bascules rapides dans la matrice se
     * marchent dessus : la seconde repart de l'état d'avant la première (le cache
     * n'était rafraîchi qu'au retour de la requête) et annule silencieusement son effet.
     */
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: sgKeys.connection(projectId) });
      const previous = qc.getQueryData<SgConnection>(sgKeys.connection(projectId));
      if (previous) qc.setQueryData(sgKeys.connection(projectId), applyPatch(previous, patch));
      return { previous };
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) qc.setQueryData(sgKeys.connection(projectId), context.previous);
    },
    onSuccess: (connection) => {
      qc.setQueryData(sgKeys.connection(projectId), connection);
    },
    // Le serveur fait foi une fois la dernière écriture retombée.
    onSettled: () => qc.invalidateQueries({ queryKey: sgKeys.connection(projectId) }),
  });
}

export function useDeleteSgConnection(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del<void>(`/api/shotgrid/projects/${projectId}/connection`),
    onSuccess: () => qc.invalidateQueries({ queryKey: sgKeys.connection(projectId) }),
  });
}

export function useRotateWebhookToken(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api
        .post<{ connection: SgConnection }>(`/api/shotgrid/projects/${projectId}/connection/rotate-token`)
        .then((r) => r.connection),
    onSuccess: (connection) => qc.setQueryData(sgKeys.connection(projectId), connection),
  });
}

// ───────────────────────────── Synchronisation ─────────────────────────────

export function useRunSync(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { kind?: 'full' | 'reconcile'; withMedia?: boolean } = {}) =>
      api.post<{ result: { runId: number; status: string; stats: Record<string, unknown> } }>(
        `/api/shotgrid/projects/${projectId}/sync`,
        body,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sgKeys.runs(projectId) });
      void qc.invalidateQueries({ queryKey: sgKeys.connection(projectId) });
      void qc.invalidateQueries({ queryKey: sgKeys.diff(projectId) });
      // La synchronisation réécrit la hiérarchie du projet : les vues doivent suivre.
      void qc.invalidateQueries({ queryKey: ['shots', projectId] });
      void qc.invalidateQueries({ queryKey: ['sequences', projectId] });
      void qc.invalidateQueries({ queryKey: ['assets', projectId] });
    },
  });
}

export function useSgRuns(projectId: number, enabled = true) {
  return useQuery({
    queryKey: sgKeys.runs(projectId),
    queryFn: () =>
      api.get<{ runs: SgSyncRun[]; openConflicts: SgSyncLog[] }>(`/api/shotgrid/projects/${projectId}/runs`),
    enabled,
  });
}

export function useSgLogs(runId: number | null, level: string) {
  return useQuery({
    queryKey: sgKeys.logs(runId ?? 0, level),
    queryFn: () =>
      api.get<{ items: SgSyncLog[]; total: number }>(
        `/api/shotgrid/runs/${runId}/logs${level ? `?level=${level}` : ''}`,
      ),
    enabled: runId !== null,
  });
}

export function useSgDiff(projectId: number, enabled: boolean) {
  return useQuery({
    queryKey: sgKeys.diff(projectId),
    queryFn: () =>
      api.get<{ diff: SgDiffReport }>(`/api/shotgrid/projects/${projectId}/diff`).then((r) => r.diff),
    enabled,
    // La comparaison interroge le site distant : on ne la relance pas à chaque retour d'onglet.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useSgImportableVersions(projectId: number, enabled: boolean) {
  return useQuery({
    queryKey: sgKeys.versions(projectId),
    queryFn: () =>
      api
        .get<{ versions: SgImportableVersion[] }>(`/api/shotgrid/projects/${projectId}/versions`)
        .then((r) => r.versions),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useImportVersions(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sgIds: number[]) =>
      api.post<{ runId: number }>(`/api/shotgrid/projects/${projectId}/import-versions`, { sgIds }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sgKeys.versions(projectId) });
      void qc.invalidateQueries({ queryKey: sgKeys.runs(projectId) });
    },
  });
}

/**
 * Arbitrage d'un conflit. La ligne de journal suffit à l'identifier — exiger en plus
 * l'exécution dont elle provient avait conduit les écrans qui ne la connaissent pas à
 * envoyer un identifiant vide, et donc à ne rien faire du tout.
 */
export function useResolveConflict(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ logId, resolution }: { logId: number; resolution: 'sg' | 'review' }) =>
      api.post<{ ok: boolean; applied: { direction: string; action: string } }>(
        `/api/shotgrid/logs/${logId}/resolve`,
        { resolution },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sgKeys.runs(projectId) });
      void qc.invalidateQueries({ queryKey: sgKeys.diff(projectId) });
    },
  });
}

// ───────────────────────────── Statuts de pipeline ─────────────────────────────

/**
 * Statuts d'un périmètre.
 *
 * Passer `projectId` restreint la liste au vocabulaire qui concerne ce projet : celui du
 * site sur un projet relié à ShotGrid, le nôtre sinon. Sans lui, on reçoit le référentiel
 * du studio entier — ce qu'il faut à l'écran d'administration, jamais à un sélecteur.
 */
export function usePipelineStatuses(scope?: 'task' | 'shot' | 'sequence', projectId?: number) {
  return useQuery({
    queryKey: sgKeys.pipelineStatuses(scope, projectId),
    queryFn: () => {
      const params = new URLSearchParams();
      if (scope) params.set('scope', scope);
      if (projectId) params.set('projectId', String(projectId));
      const query = params.toString();
      return api
        .get<{ statuses: PipelineStatus[] }>(`/api/pipeline-statuses${query ? `?${query}` : ''}`)
        .then((r) => r.statuses);
    },
    staleTime: 5 * 60_000,
  });
}

export function useSavePipelineStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<PipelineStatus> & { id?: number }) =>
      id
        ? api.patch<{ status: PipelineStatus }>(`/api/pipeline-statuses/${id}`, body)
        : api.post<{ status: PipelineStatus }>('/api/pipeline-statuses', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pipeline-statuses'] }),
  });
}

export function useDeletePipelineStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/pipeline-statuses/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pipeline-statuses'] }),
  });
}
