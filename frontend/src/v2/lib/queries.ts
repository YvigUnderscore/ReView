// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { getSocket } from '../../lib/socket';
import { qk } from './query';
import { useInfiniteList, type InfiniteList, type InfiniteListOptions } from './useInfiniteList';
import type {
  AdminProjectRow,
  AssetListItem,
  LiveSessionSummary,
  Notification,
  Project,
  ReviewStatus,
  SequenceSummary,
  ShotSummary,
  User,
  UserStatus,
} from '../types/api';

/**
 * Query hooks shared between several components (one key = one shape).
 * Queries specific to a single page stay defined in the page.
 *
 * Entity lists (projects, shots, assets) render an `InfiniteList`: `data` remains the array the callers
 * expect, but the real total and "load more" are no longer thrown away on receipt. They only load the
 * first page; a caller that needs the whole list — a selector, a modal — asks for `all`.
 */

/** List options left to the callers (the URL and the key are fixed here). */
export type ListOptions = Pick<InfiniteListOptions, 'all' | 'pageSize'>;

/** List of active projects (archived excluded) — shared by Shell / ProjectsPage. */
export function useProjectsQuery(options: ListOptions = {}): InfiniteList<Project> {
  return useInfiniteList<Project>(qk.projects, '/api/projects', options);
}

/** Archived projects (38.B) — the "Archived" tab of ProjectsPage. */
export function useArchivedProjectsQuery(enabled = true, options: ListOptions = {}): InfiniteList<Project> {
  return useInfiniteList<Project>(qk.projectsArchived, '/api/projects?archived=1', {
    ...options,
    enabled,
  });
}

/** Sequences of a project (+ count of shots outside any sequence) — sidebar / ProjectPage / AssetAssignDialog. */
export function useSequencesQuery(projectId: number, enabled = true) {
  return useQuery({
    queryKey: qk.sequences(projectId),
    queryFn: () =>
      api.get<{ sequences: SequenceSummary[]; unsequencedShots: number }>(
        `/api/sequences?projectId=${projectId}`,
      ),
    enabled,
  });
}

/** Shots of a project — ProjectPage / KanbanPage / AssetAssignDialog. */
export function useShotsQuery(
  projectId: number,
  enabled = true,
  options: ListOptions = {},
): InfiniteList<ShotSummary> {
  return useInfiniteList<ShotSummary>(qk.shots(projectId), `/api/shots?projectId=${projectId}`, {
    ...options,
    enabled,
  });
}

/** Assets of a project — sidebar / ProjectPage / ShotDetailDrawer. */
export function useAssetsQuery(
  projectId: number,
  enabled = true,
  options: ListOptions = {},
): InfiniteList<AssetListItem> {
  return useInfiniteList<AssetListItem>(qk.assets(projectId), `/api/assets?projectId=${projectId}`, {
    ...options,
    enabled,
  });
}

/** Studio review statuses (Phase 31) — badges, filters, decision menus. */
/**
 * Review statuses. With a `projectId`, the list is the project's: on a project linked to ShotGrid, it
 * narrows to the site's vocabulary rather than stacking ReView's original statuses and the studio's.
 */
export function useReviewStatusesQuery(enabled = true, projectId?: number) {
  return useQuery({
    queryKey: projectId ? [...qk.reviewStatuses, projectId] : qk.reviewStatuses,
    queryFn: () =>
      api
        .get<{ statuses: ReviewStatus[] }>(
          `/api/review-statuses${projectId ? `?projectId=${projectId}` : ''}`,
        )
        .then((d) => d.statuses),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

/** Notifications of the current user (+ unread counter) — topbar bell (10.C5). */
export interface NotificationsData {
  notifications: Notification[];
  unread: number;
}
export function useNotificationsQuery(enabled = true) {
  return useQuery({
    queryKey: qk.notifications,
    queryFn: () => api.get<NotificationsData>('/api/notifications'),
    enabled,
  });
}

/**
 * Live sessions in progress on the project (LIVE badges — feedback 33): the review button, version
 * cards. Refreshed by the `live:changed` socket event (project room, joined via `join_project` by the
 * relevant pages or right here).
 */
export function useLiveSessionsQuery(projectId: number | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (projectId === null) return;
    const socket = getSocket();
    socket.emit('join_project', projectId);
    const onChanged = (data: { projectId: number }) => {
      if (data.projectId === projectId) void qc.invalidateQueries({ queryKey: qk.liveSessions(projectId) });
    };
    socket.on('live:changed', onChanged);
    return () => {
      socket.off('live:changed', onChanged);
      // The room was never left (D3): a tab open all day ended up receiving the events of every
      // project visited, and invalidating caches that no longer concerned it.
      socket.emit('leave_project', projectId);
    };
  }, [projectId, qc]);
  return useQuery({
    queryKey: qk.liveSessions(projectId ?? 0),
    queryFn: () =>
      api
        .get<{ sessions: LiveSessionSummary[] }>(`/api/live/sessions?projectId=${projectId}`)
        .then((d) => d.sessions),
    enabled: projectId !== null,
    staleTime: 10_000,
  });
}

/** Someone from the studio's presence directory (`GET /api/users/presence`). */
export interface PresenceUser {
  id: number;
  email: string;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  status: UserStatus;
  lastSeenAt: string | null;
  online: boolean;
}

/**
 * Key of the presence directory.
 *
 * Defined here and not in `qk` (query.ts) because this file could not be touched within this batch:
 * it is meant to join its neighbours there under the name `qk.presence`. A standalone tuple rather than
 * `['users', 'presence']`, so that it does not get invalidated by ricochet on every write to `qk.users`
 * (account administration).
 */
export const presenceKey = ['presence'] as const;

/**
 * The studio's presence directory — a single request for all consumers.
 *
 * The directory used to be loaded in a `useEffect` of each consumer, outside TanStack Query: two
 * components mounted together made two requests, and each opening of the people selector made another.
 * The response carries a presigned avatar URL per account (computed on every call server-side): measured
 * at 4,724 bytes for 8 accounts, i.e. ~70 kB for a studio of 120 people.
 *
 * `staleTime` of one minute: what moves fast in this list is "who is online", and that arrives through
 * the `presence:update` socket push, which writes directly into this cache (`applyPresencePush`,
 * socketBridge). The rest — name, avatar, status — does not justify a reload on every mount.
 */
export function usePresenceQuery(enabled = true) {
  return useQuery({
    queryKey: presenceKey,
    queryFn: () => api.get<{ users: PresenceUser[] }>('/api/users/presence').then((d) => d.users),
    staleTime: 60_000,
    enabled,
  });
}

/** Viewer watermark configuration (35.B) — read by the internal viewers. */
export function useWatermarkConfigQuery() {
  return useQuery({
    queryKey: qk.watermarkConfig,
    queryFn: () =>
      api
        .get<{ watermark: { internal: boolean; shares: boolean; opacity: number } }>('/api/studio/watermark')
        .then((d) => d.watermark),
    staleTime: 5 * 60 * 1000,
  });
}

/** Task that can be proposed as a destination for a version. */
export interface ProjectTask {
  id: number;
  name: string;
  department: string | null;
  pipelineStatusId: number | null;
  parentKind: 'shot' | 'asset';
  parentName: string;
  versionCount: number;
}

/**
 * All the project's tasks.
 *
 * Loaded only when needed — when choosing where to file a version — and kept for a while: the list only
 * moves at the pace of synchronisations.
 */
export function useProjectTasks(projectId: number, enabled = true) {
  return useQuery({
    queryKey: qk.projectTasks(projectId),
    queryFn: () =>
      api.get<{ tasks: ProjectTask[] }>(`/api/tasks?projectId=${projectId}`).then((r) => r.tasks),
    enabled: enabled && projectId > 0,
    staleTime: 60_000,
  });
}

/** Every project with its admin counters (admin screens: filters, scopes, the projects tab). */
export function useAdminProjectsQuery(enabled = true) {
  return useQuery({
    queryKey: qk.adminProjects,
    queryFn: () => api.get<{ projects: AdminProjectRow[] }>('/api/admin/projects'),
    enabled,
  });
}

/** The studio's accounts (admin users tab, author filters, member picker). */
export function useUsersQuery() {
  return useQuery({
    queryKey: qk.users,
    queryFn: () => api.get<{ users: User[] }>('/api/users').then((d) => d.users),
  });
}
