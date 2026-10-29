// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import type { Department } from '../types/api';
import { qk } from './query';

/**
 * Pipeline departments (B1) — client side.
 *
 * They were an entry of a JSON array in the project settings, with no identity: it was impossible to
 * attach one to an asset one by one, or to rename it without detaching the tasks. They are now
 * entities, with a studio reference inherited by default and a clean list per project.
 *
 * The `Department` shape is that of `types/api`: this module only carries the hooks.
 */

/** Departments applicable to a project: its own, otherwise the studio's. */
export function useDepartments(projectId: number, enabled = true) {
  return useQuery({
    queryKey: qk.departments(projectId),
    queryFn: () =>
      api
        .get<{ departments: Department[] }>(`/api/projects/${projectId}/departments`)
        .then((d) => d.departments),
    enabled: enabled && projectId > 0,
    // A project's pipeline does not change several times an hour.
    staleTime: 5 * 60_000,
  });
}

export interface DepartmentInput {
  name: string;
  key?: string;
  order?: number;
  color?: string | null;
}

export function useCreateDepartment(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DepartmentInput) =>
      api.post<{ department: Department }>(`/api/projects/${projectId}/departments`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.departments(projectId) }),
  });
}

export function useUpdateDepartment(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: DepartmentInput & { id: number }) =>
      api.patch<{ department: Department }>(`/api/departments/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.departments(projectId) }),
  });
}

export function useRemoveDepartment(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del(`/api/departments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.departments(projectId) }),
  });
}

/** Departments an entity is declared to go through. The list sent replaces the previous one. */
/** Caches to refresh when an entity's steps change. */
function entityKeys(projectId: number, holder: 'assets' | 'shots' | 'sequences', id: number) {
  const singular = holder === 'assets' ? 'asset' : holder === 'shots' ? 'shot' : 'sequence';
  return [
    qk.departments(projectId),
    [singular, id],
    [holder === 'sequences' ? 'sequences' : holder, projectId],
  ];
}

export function useSetEntityDepartments(
  projectId: number,
  holder: 'assets' | 'shots' | 'sequences',
  id: number,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => api.put(`/api/${holder}/${id}/departments`, { ids }),
    // The entity's record too: invalidating only the project's department list would leave
    // the screen showing the old steps until the next reload.
    onSuccess: () => {
      for (const key of entityKeys(projectId, holder, id)) void qc.invalidateQueries({ queryKey: key });
    },
  });
}

/**
 * Ticks or unticks a step without rewriting the whole list.
 *
 * The `PUT` replaces everything: two quick toggles in a menu and the second one starts from the
 * state from before the first, cancelling its effect.
 */
export function useToggleEntityDepartment(
  projectId: number,
  holder: 'assets' | 'shots' | 'sequences',
  id: number,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (change: { add?: number[]; remove?: number[] }) =>
      api.patch(`/api/${holder}/${id}/departments`, change),
    onSuccess: () => {
      for (const key of entityKeys(projectId, holder, id)) void qc.invalidateQueries({ queryKey: key });
    },
  });
}

/**
 * A member's departments **on this project** — ticked, unticked, never replaced (batch 10).
 *
 * An artist belongs to several departments: a compositing lead who also does roto does not have to
 * choose. And the screen only displays the vocabulary of one project — sending the displayed state
 * would erase the steps coming from elsewhere, hence the named add/remove.
 */
export function useToggleMemberDepartment(projectId: number, userId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (change: { add?: number[]; remove?: number[] }) =>
      api.patch(`/api/projects/${projectId}/members/${userId}/departments`, change),
    // The project record carries the memberships: that is what the tab re-reads.
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.project(projectId) }),
  });
}
