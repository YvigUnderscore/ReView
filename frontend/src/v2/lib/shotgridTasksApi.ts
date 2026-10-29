// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { useSgConnection } from './shotgridApi';

/**
 * Pipeline steps and task creation.
 *
 * Separated from the rest of the ShotGrid API because these three calls serve a single gesture:
 * creating the missing task so that a render can be dropped.
 */

export interface SgPipelineStep {
  sgId: number;
  code: string;
  shortName: string;
  color: string | null;
  order: number;
  /** Does a task of the project already carry this step? */
  used: boolean;
}

/**
 * Steps the site knows for this kind of entity.
 *
 * These are the columns seen in ShotGrid — art, model, rig, groom, lookdev — and they exist before any
 * task. Requested only when needed: the list comes from the site, it has no business in a page's loading.
 */
export function useSgSteps(
  projectId: number,
  entityType: 'Asset' | 'Shot',
  enabled = true,
  options: { all?: boolean } = {},
) {
  const { data: connection } = useSgConnection(projectId);
  return useQuery({
    queryKey: ['shotgrid', 'steps', projectId, entityType, options.all ?? false],
    queryFn: () =>
      api
        .get<{ steps: SgPipelineStep[] }>(
          `/api/shotgrid/projects/${projectId}/steps?entityType=${entityType}${options.all ? '&all=true' : ''}`,
        )
        .then((r) => r.steps),
    enabled: enabled && Boolean(connection?.active),
    staleTime: 10 * 60_000,
  });
}

export interface SgProjectMember {
  sgId: number;
  name: string;
  email: string | null;
  userId: number | null;
}

/** People assigned to the project on the site — not the studio's directory. */
export function useSgProjectMembers(projectId: number, enabled = true) {
  const { data: connection } = useSgConnection(projectId);
  return useQuery({
    queryKey: ['shotgrid', 'members', projectId],
    queryFn: () =>
      api
        .get<{ members: SgProjectMember[] }>(`/api/shotgrid/projects/${projectId}/members`)
        .then((r) => r.members),
    enabled: enabled && Boolean(connection?.active),
    staleTime: 10 * 60_000,
  });
}

/** Creates the missing task in ShotGrid, then pulls it back. */
export function useCreateTaskFromStep(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      stepSgId: number;
      parentType: 'asset' | 'shot';
      parentId: number;
      name?: string;
      assigneeSgId?: number | null;
    }) =>
      api.post<{ taskId: number; sgId: number; name: string }>(
        `/api/shotgrid/projects/${projectId}/tasks`,
        body,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['asset'] });
      void qc.invalidateQueries({ queryKey: ['shotgrid', 'links', projectId] });
      void qc.invalidateQueries({ queryKey: ['shotgrid', 'steps', projectId] });
    },
  });
}
