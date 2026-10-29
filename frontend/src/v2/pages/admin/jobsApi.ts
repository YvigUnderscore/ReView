// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import { qk } from '@/v2/lib/query';

export interface JobRow {
  id: string | null;
  name: string;
  data: Record<string, unknown>;
  failedReason: string | null;
  attemptsMade: number;
  createdAt: string | null;
}

export interface QueueView {
  key: string;
  counts: Record<string, number>;
  failed: JobRow[];
  active: JobRow[];
  waiting: JobRow[];
}

export interface PurgeConfig {
  enabled: boolean;
  keepVersions: number;
}

export const jobsKey = qk.admin('jobs');
export const derivedPurgeKey = qk.admin('derived-purge');

/** BullMQ queues, polled every five seconds while the tab is open. */
export function useJobsQuery() {
  return useQuery({
    queryKey: jobsKey,
    queryFn: () => api.get<{ queues: QueueView[] }>('/api/admin/jobs').then((d) => d.queues),
    refetchInterval: 5000,
  });
}

export function useDerivedPurgeQuery() {
  return useQuery({
    queryKey: derivedPurgeKey,
    queryFn: () => api.get<{ config: PurgeConfig }>('/api/admin/derived-purge').then((d) => d.config),
  });
}

export const jobsApi = {
  retry: (queue: string, id: string) => api.post(`/api/admin/jobs/${queue}/${id}/retry`),
  cleanFailed: (queue: string) => api.post<{ removed: number }>(`/api/admin/jobs/${queue}/clean-failed`),
  savePurge: (config: PurgeConfig) => api.put('/api/admin/derived-purge', config),
  runPurge: () => api.post<{ purged: number }>('/api/admin/derived-purge/run'),
};
