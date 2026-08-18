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
