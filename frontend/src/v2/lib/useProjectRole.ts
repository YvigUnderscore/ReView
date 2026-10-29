// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import { useAuth } from '../stores/useAuth';
import { personLabel } from './peopleSearch';
import type { Role } from '../types/api';

/**
 * Effective role on a project (C3).
 *
 * The API has returned it since phase 38 (`myRole` on `GET /api/projects/:id`) and the front
 * never read it: each screen derived rights from the account's **global** role. A
 * project supervisor — a role given by membership, not by the account — was therefore
 * refused on screen what the server allowed, and had to ask an administrator.
 *
 * The global role still takes precedence when it is already sufficient: a studio ADMIN
 * manages all projects, member or not.
 */

export interface ProjectRoleInfo {
  /** Role on this project, `null` until the request has answered. */
  role: Role | null;
  /** Can modify the project's structure (entity settings, creation, deletion). */
  canManage: boolean;
  /** Can produce content (versions, comments) — everyone except clients. */
  canContribute: boolean;
}

export function projectRoleInfo(globalRole: Role | undefined, projectRole: Role | null): ProjectRoleInfo {
  const effective = globalRole === 'ADMIN' ? 'ADMIN' : (projectRole ?? globalRole ?? null);
  return {
    role: effective,
    canManage: effective === 'ADMIN' || effective === 'SUPERVISOR',
    canContribute: effective !== null && effective !== 'CLIENT',
  };
}

export function useProjectRole(projectId: number): ProjectRoleInfo {
  const globalRole = useAuth((s) => s.user?.role);
  const { data } = useQuery({
    queryKey: qk.project(projectId),
    queryFn: () => api.get<{ project: { myRole?: Role | null } }>(`/api/projects/${projectId}`),
    enabled: projectId > 0,
    staleTime: 5 * 60_000,
  });
  return projectRoleInfo(globalRole, data?.project.myRole ?? null);
}

/** A person to whom work on this project can be entrusted. */
export interface AssignableMember {
  id: number;
  name: string;
  role: Role;
  /** Email: on a team where two accounts share a name, this is what breaks the tie. */
  email: string;
  /** Photo already signed by the server — see `ProjectService.getProject`. */
  avatarUrl: string | null;
}

interface MembershipRow {
  role: Role | null;
  user: {
    id: number;
    name: string | null;
    username?: string | null;
    email: string;
    role: Role;
    isService?: boolean;
    avatarUrl?: string | null;
  };
}

/**
 * Project members who can receive work.
 *
 * Service accounts and clients are excluded — the server refuses them anyway,
 * so there is no point offering them.
 */
export function useProjectMembers(projectId: number): AssignableMember[] {
  return useMembers(projectId, (role) => role !== 'CLIENT');
}

/**
 * Project members one can expect in review.
 *
 * The client IS a reviewer — it is the role that carries this name — so it appears here, where
 * `useProjectMembers` excludes it: one does not entrust work to them, one asks their opinion.
 * Service accounts stay off the list in both cases: a machine identity
 * does not open the review.
 */
export function useProjectReviewers(projectId: number): AssignableMember[] {
  return useMembers(projectId, () => true);
}

/**
 * The base of both: a single request, a single cache key. The project sheet is
 * already loaded everywhere — requesting it a second time for the same data would be wasteful.
 */
function useMembers(projectId: number, keepRole: (role: Role) => boolean): AssignableMember[] {
  const { data } = useQuery({
    queryKey: qk.project(projectId),
    queryFn: () => api.get<{ project: { memberships?: MembershipRow[] } }>(`/api/projects/${projectId}`),
    enabled: projectId > 0,
    staleTime: 5 * 60_000,
  });
  const rows = data?.project.memberships ?? [];
  return rows
    .filter((m) => !m.user.isService && keepRole(m.role ?? m.user.role))
    .map((m) => ({
      id: m.user.id,
      name: personLabel(m.user),
      role: m.role ?? m.user.role,
      email: m.user.email,
      avatarUrl: m.user.avatarUrl ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
