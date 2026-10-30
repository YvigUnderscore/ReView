// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import type {
  PipelineStatus,
  StatusScope,
  SgConnection,
  SgDiffReport,
  SgImportableVersion,
  SgRemoteProject,
  SgSettings,
  SgSite,
  SgSyncLog,
  SgSyncRun,
} from '../types/shotgrid';

/** Access to the ShotGrid API — cache keys and mutations, in the `qk.*` convention. */

export const sgKeys = {
  sites: ['shotgrid', 'sites'] as const,
  remoteProjects: (siteId: number, query: string) =>
    ['shotgrid', 'sites', siteId, 'projects', query] as const,
  connection: (projectId: number) => ['shotgrid', 'connection', projectId] as const,
  webhookSecret: (projectId: number) => ['shotgrid', 'webhook-secret', projectId] as const,
  runs: (projectId: number) => ['shotgrid', 'runs', projectId] as const,
  logs: (runId: number, level: string) => ['shotgrid', 'logs', runId, level] as const,
  diff: (projectId: number) => ['shotgrid', 'diff', projectId] as const,
  versions: (projectId: number) => ['shotgrid', 'versions', projectId] as const,
  crew: (projectId: number) => ['shotgrid', 'crew', projectId] as const,
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

/** Site projects: this list is what designates the target by its name. */
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

// ───────────────────────────── Connection ─────────────────────────────

export function useSgConnection(projectId: number) {
  return useQuery({
    queryKey: sgKeys.connection(projectId),
    queryFn: () =>
      api
        .get<{ connection: SgConnection | null }>(`/api/shotgrid/projects/${projectId}/connection`)
        .then((r) => r.connection),
    // The project is not known yet (an entity page discovers it while loading its entity):
    // asking for the connection of project "0" can only return an error.
    enabled: projectId > 0,
    // Without a connection the response is `null`: no point coming back to it again and again.
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

/** Settings sections deep-merged — the same as on the server side. */
const MERGED_SECTIONS = ['domains', 'media', 'push', 'reconcile', 'steps'] as const;

type SgPatch = { settings?: Partial<SgSettings>; active?: boolean; webhookSecret?: string | null };

/**
 * Applies the patch to the cache exactly as the server will: one level deep.
 * A flat `setQueryData` would replay the defect being fixed on the route side.
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
     * Optimistic update — without it, two quick toggles in the matrix step on each other:
     * the second starts from the state from before the first (the cache was only refreshed when the
     * request came back) and silently cancels its effect.
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
    // The server is authoritative once the last write has landed.
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

/**
 * Webhook signing secret — requested only when the screen needs to show it.
 *
 * It does not travel with the connection: `enabled` stays false until someone has clicked "show", and
 * the result is not kept in cache beyond the open screen.
 */
export function useWebhookSecret(projectId: number, enabled: boolean) {
  return useQuery({
    queryKey: sgKeys.webhookSecret(projectId),
    queryFn: () =>
      api
        .get<{ secret: string | null }>(`/api/shotgrid/projects/${projectId}/connection/webhook-secret`)
        .then((r) => r.secret),
    enabled,
    gcTime: 0,
    staleTime: 0,
  });
}

export function useRotateWebhookSecret(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api
        .post<{ secret: string }>(`/api/shotgrid/projects/${projectId}/connection/rotate-secret`)
        .then((r) => r.secret),
    // The connection itself has not moved: only the value displayed next to it changes.
    onSuccess: (secret) => qc.setQueryData(sgKeys.webhookSecret(projectId), secret),
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
      // The sync rewrites the project's hierarchy: the views must follow.
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
    // The comparison queries the remote site: we do not re-run it on every tab return.
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
 * Resolving a conflict. The journal line is enough to identify it — additionally requiring the
 * execution it comes from had led the screens that do not know it to send an empty identifier, and
 * therefore to do nothing at all.
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

// ───────────────────────────── Pipeline statuses ─────────────────────────────

/**
 * Statuses of a scope.
 *
 * Passing `projectId` restricts the list to the vocabulary that concerns that project: the site's on a
 * project linked to ShotGrid, ours otherwise. Without it, the whole studio's catalogue is received —
 * what the admin screen needs, never a selector.
 */
export function usePipelineStatuses(
  scope?: StatusScope,
  projectId?: number,
  // `all`: the full catalogue, without the sort the studio made for this project. Reserved for the
  // screen that adjusts precisely that sort — everywhere else, we want the reduced list.
  options: { all?: boolean } = {},
) {
  return useQuery({
    queryKey: [...sgKeys.pipelineStatuses(scope, projectId), options.all ?? false],
    queryFn: () => {
      const params = new URLSearchParams();
      if (scope) params.set('scope', scope);
      if (projectId) params.set('projectId', String(projectId));
      if (options.all) params.set('all', 'true');
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
