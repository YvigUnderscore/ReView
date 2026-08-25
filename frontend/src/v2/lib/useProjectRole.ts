// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import { useAuth } from '../stores/useAuth';
import type { Role } from '../types/api';

/**
 * Rôle effectif sur un projet (C3).
 *
 * L'API le renvoie depuis la phase 38 (`myRole` sur `GET /api/projects/:id`) et le front
 * ne l'a jamais lu : chaque écran déduisait les droits du rôle **global** du compte. Un
 * superviseur de projet — rôle donné par membership, pas par le compte — se voyait donc
 * refuser côté écran ce que le serveur lui ouvrait, et devait demander à un administrateur.
 *
 * Le rôle global reste prioritaire quand il est déjà suffisant : un ADMIN du studio gère
 * tous les projets, membre ou non.
 */

export interface ProjectRoleInfo {
  /** Rôle sur ce projet, `null` tant que la requête n'a pas répondu. */
  role: Role | null;
  /** Peut modifier la structure du projet (réglages d'entité, création, suppression). */
  canManage: boolean;
  /** Peut produire du contenu (versions, commentaires) — tout le monde sauf les clients. */
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

/** Une personne à qui l'on peut confier du travail sur ce projet. */
export interface AssignableMember {
  id: number;
  name: string;
  role: Role;
  /** Photo déjà signée par le serveur — cf. `ProjectService.getProject`. */
  avatarUrl: string | null;
}

interface MembershipRow {
  role: Role | null;
  user: {
    id: number;
    name: string | null;
    email: string;
    role: Role;
    isService?: boolean;
    avatarUrl?: string | null;
  };
}

/**
 * Membres du projet qui peuvent recevoir du travail.
 *
 * Même clé de cache et même requête que `useProjectRole` : la fiche du projet est déjà
 * chargée partout, une seconde requête pour la même donnée serait du gaspillage. Les
 * comptes de service et les clients sont écartés — le serveur les refuse de toute façon,
 * autant ne pas les proposer.
 */
export function useProjectMembers(projectId: number): AssignableMember[] {
  const { data } = useQuery({
    queryKey: qk.project(projectId),
    queryFn: () => api.get<{ project: { memberships?: MembershipRow[] } }>(`/api/projects/${projectId}`),
    enabled: projectId > 0,
    staleTime: 5 * 60_000,
  });
  const rows = data?.project.memberships ?? [];
  return rows
    .filter((m) => !m.user.isService && (m.role ?? m.user.role) !== 'CLIENT')
    .map((m) => ({
      id: m.user.id,
      name: m.user.name ?? m.user.email,
      role: m.role ?? m.user.role,
      avatarUrl: m.user.avatarUrl ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
