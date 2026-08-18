// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';

/**
 * Départements du pipeline (B1) — côté client.
 *
 * Ils étaient une entrée d'un tableau JSON dans les réglages du projet, sans identité :
 * impossible d'en rattacher un à un asset, ni de le renommer sans détacher les tâches.
 * Ce sont maintenant des entités, avec un référentiel de studio hérité par défaut et une
 * liste propre par projet.
 */

export interface Department {
  id: number;
  studioId: number;
  projectId: number | null;
  key: string;
  name: string;
  order: number;
  color: string | null;
}

/** Départements applicables à un projet : les siens, sinon ceux du studio. */
export function useDepartments(projectId: number, enabled = true) {
  return useQuery({
    queryKey: qk.departments(projectId),
    queryFn: () =>
      api
        .get<{ departments: Department[] }>(`/api/projects/${projectId}/departments`)
        .then((d) => d.departments),
    enabled: enabled && projectId > 0,
    // Le pipe d'un projet ne change pas plusieurs fois par heure.
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

/** Départements que déclare traverser une entité. La liste envoyée remplace la précédente. */
export function useSetEntityDepartments(
  projectId: number,
  holder: 'assets' | 'shots' | 'sequences',
  id: number,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => api.put(`/api/${holder}/${id}/departments`, { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.departments(projectId) }),
  });
}
