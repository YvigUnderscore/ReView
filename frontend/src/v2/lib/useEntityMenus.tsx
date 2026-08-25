// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type ReactNode } from 'react';
import { EyeOff, Eye, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { useAuth } from '../stores/useAuth';
import PeopleAssignDialog, { type AssignKind } from '../components/entity/PeopleAssignDialog';
import type { MenuEntry } from './menuSpec';
import type { AssigneeRef } from '../types/entities';
import { useT } from '../i18n';

/**
 * Deux gestes que le clic droit doit porter sur toute entité de pipeline.
 *
 * **Personnes** — assigner quelqu'un demandait d'ouvrir la fiche, puis chaque tâche. Le
 * geste s'énonce depuis la carte, il doit s'y faire.
 *
 * **Masquer** — réservé aux ADMIN, et volontairement sans retour depuis la carte : une
 * fois masqué, l'élément disparaît de la liste où l'on vient de cliquer. C'est exactement
 * ce qu'on a demandé ; c'est aussi pourquoi l'écran d'administration est le seul endroit
 * d'où on peut le faire réapparaître, et le message de confirmation le dit.
 *
 * Les deux rendent une entrée **et** leur dialogue : un formulaire ne peut pas vivre dans
 * un menu qui se ferme au premier clic.
 */

/** Ce qu'une entité doit exposer pour que ces gestes s'appliquent. */
export interface MenuTarget {
  id: number;
  /** Nom lisible, pour le titre du dialogue. */
  label: string;
  assignees?: AssigneeRef[];
}

export function useEntityMenus(projectId: number, kind: AssignKind) {
  const t = useT();
  const qc = useQueryClient();
  const role = useAuth((s) => s.user?.role);
  const isAdmin = role === 'ADMIN';
  const [assigning, setAssigning] = useState<MenuTarget | null>(null);

  /** `episodes` → `episode` : le segment d'URL est au pluriel, le type de l'API au singulier. */
  const singular = kind.slice(0, -1);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: [kind, projectId] });
    void qc.invalidateQueries({ queryKey: [singular] });
  };

  /** Sous-menu « Personnes… » — absent sans droit de gestion. */
  const peopleEntry = (target: MenuTarget, canManage: boolean): MenuEntry | null =>
    canManage
      ? {
          id: `people-${target.id}`,
          label: t('assignees.menu'),
          icon: <Users size={14} />,
          onSelect: () => setAssigning(target),
        }
      : null;

  /**
   * « Masquer » / « Afficher de nouveau ».
   *
   * Une carte visible ne peut proposer que « masquer » : si l'élément était masqué, il ne
   * serait pas là. L'entrée inverse existe pour les écrans d'administration, qui listent
   * précisément ce qui est masqué.
   */
  const hideEntry = (target: MenuTarget & { hidden?: boolean }): MenuEntry | null => {
    if (!isAdmin) return null;
    const hidden = target.hidden ?? false;
    return {
      id: `visibility-${target.id}`,
      label: hidden ? t('visibility.show') : t('visibility.hide'),
      icon: hidden ? <Eye size={14} /> : <EyeOff size={14} />,
      onSelect: () => {
        void api
          .put(`/api/visibility/${singular}/${target.id}`, { hidden: !hidden })
          .then(() => {
            toast.success(hidden ? t('visibility.restored') : t('visibility.done'));
            refresh();
          })
          .catch((err: unknown) =>
            toast.error(err instanceof Error ? err.message : t('common.error.generic')),
          );
      },
    };
  };

  const dialog: ReactNode = assigning ? (
    <PeopleAssignDialog
      projectId={projectId}
      kind={kind}
      id={assigning.id}
      title={assigning.label}
      current={assigning.assignees ?? []}
      onClose={() => setAssigning(null)}
      onSaved={refresh}
    />
  ) : null;

  return { peopleEntry, hideEntry, dialog };
}
