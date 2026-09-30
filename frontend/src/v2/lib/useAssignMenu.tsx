// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Check, Layers, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import { useT } from '../i18n';
import { useDepartments, useToggleEntityDepartment } from './departmentsApi';
import { useProjectMembers } from './useProjectRole';
import { useSgConnection } from './shotgridApi';
import { assignBody, assignGroups, departmentsOf } from './assignMenu';
import type { MenuEntry } from './menuSpec';

/**
 * Sous-menus « Assigner » et « Départements » pour un asset ou un plan.
 *
 * Confier un asset à quelqu'un demandait d'ouvrir chacune de ses tâches, une par une ;
 * déclarer les étapes qu'il traverse demandait d'ouvrir son panneau de réglages. Les deux
 * gestes tiennent maintenant dans le menu contextuel, là où l'entité est visible.
 */

type Holder = 'asset' | 'shot';
const SEGMENT: Record<Holder, 'assets' | 'shots'> = { asset: 'assets', shot: 'shots' };

export interface AssignTarget {
  id: number;
  /** Étapes déclarées par l'entité. */
  departments?: { id: number; name: string }[];
  /** Ses tâches, pour savoir qui est déjà dessus. */
  tasks?: {
    departmentId: number | null;
    departmentRef?: { id: number; name: string } | null;
    assignee: { id: number } | null;
  }[];
}

export function useAssignMenu(projectId: number, holder: Holder) {
  const t = useT();
  const qc = useQueryClient();
  const members = useProjectMembers(projectId);
  const { data: allDepartments = [] } = useDepartments(projectId, projectId > 0);
  const { data: connection } = useSgConnection(projectId);
  const linked = Boolean(connection?.active);

  const assign = useMutation({
    mutationFn: ({ id, ...body }: { id: number; userId: number | null; departmentIds: number[] }) =>
      api.post<{ updated: number; created: number }>(`/api/${SEGMENT[holder]}/${id}/assign`, body),
  });

  const refresh = (id: number) => {
    void qc.invalidateQueries({ queryKey: [holder, id] });
    void qc.invalidateQueries({ queryKey: [SEGMENT[holder], projectId] });
    void qc.invalidateQueries({ queryKey: qk.projectBoard(projectId) });
    void qc.invalidateQueries({ queryKey: qk.projectTasks(projectId) });
  };

  /**
   * Sous-menu « Assigner » : un niveau par département, puis les personnes. Absent quand
   * le projet n'a ni membre assignable ni étape — il n'y aurait rien à choisir.
   */
  const assignEntry = (target: AssignTarget, canManage: boolean): MenuEntry | null => {
    if (!canManage || members.length === 0) return null;
    // Une liste **vide** n'est pas une absence de liste : un asset qui ne déclare aucune
    // étape doit se voir proposer le pipe du projet, pas un menu absent.
    const declared = target.departments?.length ? target.departments : allDepartments;
    const departments = departmentsOf(declared, target.tasks ?? []);
    if (departments.length === 0) return null;
    const groups = assignGroups(departments, members, { linked, t });
    return {
      kind: 'submenu',
      id: 'assign',
      label: t('assign.menu'),
      icon: <UserPlus size={14} />,
      items: groups.map((group) => ({
        kind: 'submenu' as const,
        id: `assign-dept-${group.departmentId}`,
        label: group.label,
        items: [
          {
            kind: 'radiogroup' as const,
            id: `assign-group-${group.departmentId}`,
            value: group.value,
            onValueChange: (value) => {
              if (value === group.value) return;
              void (async () => {
                try {
                  await assign.mutateAsync({ id: target.id, ...assignBody(group.departmentId, value) });
                  toast.success(t('assign.done'));
                  refresh(target.id);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : t('assign.failed'));
                }
              })();
            },
            // Le département sans tâche sur un projet piloté depuis ShotGrid reste visible
            // mais inerte : masquer l'étape ferait croire que le pipe ne la prévoit pas.
            items: group.items.map((item) => ({ ...item, disabled: group.disabled })),
          },
        ],
      })),
    };
  };

  return { assignEntry, hasMembers: members.length > 0 };
}

/**
 * Sous-menu « Départements » : cocher les étapes que l'entité traverse, sans ouvrir ses
 * réglages. La bascule est ciblée (ajout/retrait), pas un remplacement de la liste —
 * deux clics rapides s'annulaient autrement l'un l'autre.
 */
export function useDepartmentMenu(projectId: number, holder: Holder, id: number) {
  const t = useT();
  const { data: allDepartments = [] } = useDepartments(projectId, projectId > 0);
  const toggle = useToggleEntityDepartment(projectId, SEGMENT[holder], id);

  const entry = (current: { id: number }[] | undefined, canManage: boolean): MenuEntry | null => {
    if (!canManage || allDepartments.length === 0) return null;
    const owned = new Set((current ?? []).map((d) => d.id));
    return {
      kind: 'submenu',
      id: 'departments',
      label: t('departments.menu'),
      icon: <Layers size={14} />,
      items: allDepartments.map((department) => ({
        id: `department-${department.id}`,
        label: department.name,
        // Coche à l'emplacement de l'icône : l'écrire dans le libellé décalerait les noms
        // les uns par rapport aux autres et mêlerait donnée et présentation.
        icon: owned.has(department.id) ? <Check size={13} /> : <span className="size-3" />,
        onSelect: () => {
          void (async () => {
            try {
              await toggle.mutateAsync(
                owned.has(department.id) ? { remove: [department.id] } : { add: [department.id] },
              );
              toast.success(t('departments.updated'));
            } catch (err) {
              toast.error(err instanceof Error ? err.message : t('common.error.generic'));
            }
          })();
        },
      })),
    };
  };

  return { entry };
}
