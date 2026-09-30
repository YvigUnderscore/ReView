// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Tag, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import { useStatusMenu } from '../../../lib/useStatusMenu';
import { useUndoToast } from '../../../lib/useUndoToast';
import { useProjectMembers } from '../../../lib/useProjectRole';
import { currentStatusValue } from '../../../lib/statusMenu';
import type { MenuEntry } from '../../../lib/menuSpec';
import type { TaskStatus } from '../../../types/api';
import { useT, type Tr } from '../../../i18n';
import type { GridCell, GridRow } from './gridWire';

/**
 * Les gestes de la grille, montés UNE fois pour toute la table.
 *
 * Douze cents cases, et chacune doit pouvoir changer de statut ou d'assigné au clic droit.
 * Un hook par case aurait ouvert douze cents requêtes de référentiel : les menus sont donc
 * construits ici et distribués comme des données, exactement comme le kanban distribue son
 * `menuFor`.
 *
 * La règle de statut n'est pas réécrite — choix offerts, valeur cochée, corps du `PATCH` et
 * envoi vers ShotGrid viennent de `lib/statusMenu` via `useStatusMenu`. Ce module n'ajoute
 * que ce que la grille sait de plus : rafraîchir SES pages après coup, puisque la liste
 * paginée par curseur n'est dans aucun des caches que le sous-menu partagé invalide.
 */

/** Sentinelle « personne » : un groupe radio ne peut pas porter une valeur vide. */
const NO_ASSIGNEE = 'none';

export interface GridActions {
  /** Menu d'une case : statut, assignation. Vide si la case ne porte pas de tâche. */
  cellMenuFor: (cell: GridCell) => MenuEntry[];
  /** Menu de la colonne de tête : le statut propre du plan. */
  shotMenuFor: (row: GridRow) => MenuEntry[];
  /** Photo d'un membre, pour l'avatar d'une case — la grille ne sert que des identifiants. */
  avatarOf: (userId: number) => string | null;
}

/** Pastille de la teinte du référentiel — un fragment, pas un composant (ce module est un hook). */
function statusDot(color: string | null) {
  if (!color) return <span className="size-2.5 shrink-0" />;
  return (
    <span
      className="size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/20"
      style={{ backgroundColor: color }}
    />
  );
}

/** L'entité telle que `currentStatusValue` l'attend, lue depuis une case. */
function cellTarget(cell: GridCell) {
  const legacy = cell.status && cell.status.id === null ? (cell.status.code as TaskStatus) : null;
  return { id: cell.taskId ?? 0, pipelineStatusId: cell.status?.id ?? null, status: legacy };
}

type StatusMenu = ReturnType<typeof useStatusMenu>;

/**
 * Le sous-menu « Statut » d'une entité, suivi du rafraîchissement de la grille.
 *
 * `useStatusMenu.entry()` ne convient pas tel quel : il ne sait pas rafraîchir les pages de la
 * grille, qui ne sont dans aucun cache partagé. On reprend donc ses CHOIX — la règle — et on
 * lui confie l'écriture avec ce qu'elle doit rejouer après coup (`after`) et la valeur d'avant
 * (`undoTo`), qui fait apparaître « Annuler » dans le toast.
 */
function statusSubmenu(
  menu: StatusMenu,
  entityId: number,
  target: { pipelineStatusId: number | null; status: TaskStatus | null },
  t: Tr,
  refresh: () => Promise<void>,
): MenuEntry | null {
  if (menu.choices.length === 0) return null;
  const value = currentStatusValue(menu.choices, target);
  return {
    kind: 'submenu',
    id: 'grid-status',
    label: t('pipeline.status.menu'),
    icon: <Tag size={14} />,
    items: [
      {
        kind: 'radiogroup',
        id: 'grid-status-group',
        value,
        // Radix rappelle le gestionnaire sur l'item déjà coché : sans cette sortie, chaque
        // ouverture suivie d'un clic repartirait vers le serveur pour rien.
        onValueChange: (next) => {
          if (next === value) return;
          void menu.apply(entityId, next, { undoTo: value, after: refresh });
        },
        items: menu.choices.map((choice) => ({
          id: `grid-status-${choice.value}`,
          value: choice.value,
          label: choice.label,
          icon: statusDot(choice.color),
        })),
      },
    ],
  };
}

export function useGridActions(projectId: number, canEdit: boolean): GridActions {
  const t = useT();
  const qc = useQueryClient();
  const { done } = useUndoToast();
  const taskStatus = useStatusMenu(projectId, 'task');
  const shotStatus = useStatusMenu(projectId, 'shot');
  const members = useProjectMembers(projectId);

  const avatars = useMemo(() => new Map(members.map((member) => [member.id, member.avatarUrl])), [members]);

  /** Toutes les pages de la grille, quel que soit le filtre courant. */
  const refresh = () => qc.invalidateQueries({ queryKey: qk.projectGridAll(projectId) });

  /**
   * L'écriture d'assignation, séparée de la mutation : l'annulation la rejoue à l'envers, et
   * son échec doit remonter au toast qui l'a proposée plutôt que devenir un second succès.
   */
  const writeAssignee = async (taskId: number, assigneeId: number | null): Promise<void> => {
    await api.patch(`/api/tasks/${taskId}`, { assigneeId });
    await refresh();
  };

  const assign = useMutation({
    mutationFn: (vars: { taskId: number; assigneeId: number | null; previous: number | null }) =>
      writeAssignee(vars.taskId, vars.assigneeId),
    onSuccess: (_data, vars) => {
      const member = members.find((m) => m.id === vars.assigneeId);
      // Remettre l'assigné d'avant est une écriture de plus, pas un retour en arrière local :
      // un cran offert dans le toast, et rien qui ressemble à une pile (cf. `useUndoToast`).
      done(member ? t('production.grid.assigned', { name: member.name }) : t('production.grid.cleared'), () =>
        writeAssignee(vars.taskId, vars.previous),
      );
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : t('common.error.generic')),
  });

  const assignEntry = (cell: GridCell, taskId: number): MenuEntry | null => {
    if (members.length === 0) return null;
    const value = cell.assignee ? String(cell.assignee.id) : NO_ASSIGNEE;
    return {
      kind: 'submenu',
      id: 'grid-assign',
      label: t('production.grid.assign'),
      icon: <UserRound size={14} />,
      items: [
        {
          kind: 'radiogroup',
          id: 'grid-assign-group',
          value,
          onValueChange: (next) => {
            if (next === value) return;
            assign.mutate({
              taskId,
              assigneeId: next === NO_ASSIGNEE ? null : Number(next),
              previous: cell.assignee?.id ?? null,
            });
          },
          items: [
            ...members.map((member) => ({
              id: `grid-assign-${member.id}`,
              value: String(member.id),
              label: member.name,
            })),
            { id: 'grid-assign-none', value: NO_ASSIGNEE, label: t('production.grid.unassigned') },
          ],
        },
      ],
    };
  };

  const cellMenuFor = (cell: GridCell): MenuEntry[] => {
    const taskId = cell.taskId;
    // Pas de tâche, pas de menu : changer le statut d'une case vide n'a pas de sens, et
    // `tidyMenu` ferait de toute façon disparaître un menu sans entrée.
    if (!canEdit || taskId === null) return [];
    const entries = [
      statusSubmenu(taskStatus, taskId, cellTarget(cell), t, refresh),
      assignEntry(cell, taskId),
    ];
    return entries.filter((entry): entry is MenuEntry => entry !== null);
  };

  const shotMenuFor = (row: GridRow): MenuEntry[] => {
    if (!canEdit) return [];
    // Un plan n'a pas de repli sur l'enum figé : son `PATCH` n'accepte que le référentiel.
    const target = { pipelineStatusId: row.status?.id ?? null, status: null };
    const entry = statusSubmenu(shotStatus, row.shotId, target, t, refresh);
    return entry ? [entry] : [];
  };

  return { cellMenuFor, shotMenuFor, avatarOf: (userId) => avatars.get(userId) ?? null };
}
