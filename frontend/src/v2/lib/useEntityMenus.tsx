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
 * Two gestures that the right click must carry on every pipeline entity.
 *
 * **People** — assigning someone used to mean opening the sheet, then each task. The
 * gesture is stated from the card, it must work from there.
 *
 * **Hide** — reserved for ADMINs, and deliberately with no way back from the card: once
 * hidden, the item disappears from the list one has just clicked in. That is exactly
 * what was asked for; it is also why the administration screen is the only place
 * from which it can be brought back, and the confirmation message says so.
 *
 * Both render an entry **and** their dialog: a form cannot live in
 * a menu that closes at the first click.
 */

/** What an entity must expose for these gestures to apply. */
export interface MenuTarget {
  id: number;
  /** Readable name, for the dialog title. */
  label: string;
  assignees?: AssigneeRef[];
}

export function useEntityMenus(projectId: number, kind: AssignKind) {
  const t = useT();
  const qc = useQueryClient();
  const role = useAuth((s) => s.user?.role);
  const isAdmin = role === 'ADMIN';
  const [assigning, setAssigning] = useState<MenuTarget | null>(null);

  /** `episodes` → `episode`: the URL segment is plural, the API type singular. */
  const singular = kind.slice(0, -1);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: [kind, projectId] });
    void qc.invalidateQueries({ queryKey: [singular] });
  };

  /** "People…" submenu — absent without management rights. */
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
   * "Hide" / "Show again".
   *
   * A visible card can only offer "hide": if the item were hidden, it would not
   * be there. The reverse entry exists for the administration screens, which list
   * precisely what is hidden.
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
