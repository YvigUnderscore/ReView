// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import type { Department } from '../types/api';
import { qk } from './query';

/**
 * Départements du pipeline (B1) — côté client.
 *
 * Ils étaient une entrée d'un tableau JSON dans les réglages du projet, sans identité :
 * impossible d'en rattacher un à un asset, ni de le renommer sans détacher les tâches.
 * Ce sont maintenant des entités, avec un référentiel de studio hérité par défaut et une
 * liste propre par projet.
 *
 * La shape `Department` est celle de `types/api` : ce module ne porte que les hooks.
 */

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
/** Les caches à rafraîchir quand les étapes d'une entité changent. */
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
    // La fiche de l'entité aussi : n'invalider que la liste des départements du projet
    // laissait l'écran afficher les anciennes étapes jusqu'au prochain rechargement.
    onSuccess: () => {
      for (const key of entityKeys(projectId, holder, id)) void qc.invalidateQueries({ queryKey: key });
    },
  });
}

/**
 * Coche ou décoche une étape sans réécrire la liste entière.
 *
 * Le `PUT` remplace tout : deux bascules rapides dans un menu et la seconde repart de
 * l'état d'avant la première, annulant son effet.
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
