// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { api } from '../../lib/apiClient';
import type { TaskStatus, VersionStatus } from '../types/api';

/** Client des actions groupées (13.C) — miroir de `routes/bulk.routes.ts`. */

export type BulkDeleteDomain =
  'projects' | 'episodes' | 'sequences' | 'shots' | 'assets' | 'versions' | 'media';

export const bulkDelete = (domain: BulkDeleteDomain, ids: number[]) =>
  api.post<{ count: number }>(`/api/bulk/${domain}/delete`, { ids });

export const bulkRestore = (domain: BulkDeleteDomain, ids: number[]) =>
  api.post<{ count: number }>(`/api/bulk/${domain}/restore`, { ids });

export const bulkPurge = (domain: BulkDeleteDomain, ids: number[]) =>
  api.post<{ count: number }>(`/api/bulk/${domain}/purge`, { ids });

export const bulkPatchTasks = (ids: number[], patch: { status?: TaskStatus; assigneeId?: number | null }) =>
  api.patch<{ count: number }>('/api/bulk/tasks', { ids, ...patch });

export const bulkPatchVersions = (ids: number[], status: VersionStatus) =>
  api.patch<{ count: number }>('/api/bulk/versions', { ids, status });

export const bulkMoveShots = (ids: number[], sequenceId: number | null) =>
  api.patch<{ count: number }>('/api/bulk/shots/move', { ids, sequenceId });
