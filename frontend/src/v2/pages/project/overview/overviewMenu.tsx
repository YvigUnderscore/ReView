// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Check, LayoutGrid, Plus, RefreshCw, RotateCcw, UserCog, UserMinus } from 'lucide-react';
import { separator, type MenuEntry } from '@/v2/lib/menuSpec';
import { ROLE_LABEL_KEY } from '@/v2/lib/userStatus';
import type { WidgetsPref } from '@/v2/lib/widgetLayout';
import type { Role } from '@/v2/types/api';
import type { Tr } from '@/v2/i18n';
import { OVERVIEW_WIDGET_DEFS, addableOverviewWidgets, type OverviewWidgetId } from './overviewWidgets';

/**
 * The context menu of the overview: everything that can be done to the page is done here.
 *
 * The project's rule is that an action goes through right-click before getting a button: a page
 * that composes itself therefore has no toolbar, it has a menu. Only the "customize" toggle is
 * entitled to an icon, because a menu one does not suspect does not exist.
 *
 * The administration entries are not a reserved decoration: the server refuses the write to anyone
 * who is not a studio administrator (`requireRole(ADMIN)`).
 */

const ROLES: Role[] = ['ADMIN', 'SUPERVISOR', 'ARTIST', 'CLIENT'];

export interface OverviewMenuOptions {
  t: Tr;
  editing: boolean;
  ready: boolean;
  layout: WidgetsPref;
  /** True if the person has set their own page: otherwise, there is nothing to reset to the default. */
  personalised: boolean;
  canManage: boolean;
  isAdmin: boolean;
  /** Roles for which the administration has already saved a default. */
  definedRoles: Role[];
  onToggleEdit: () => void;
  onShow: (id: OverviewWidgetId) => void;
  onUseRoleDefault: () => void;
  onSaveRoleDefault: (role: Role, layout: WidgetsPref | null) => void;
  onRefresh: () => void;
}

export function overviewMenuEntries(options: OverviewMenuOptions): MenuEntry[] {
  const { t, layout, canManage, isAdmin } = options;
  const addable = addableOverviewWidgets(layout, canManage);

  const entries: MenuEntry[] = [
    {
      id: 'customise',
      label: options.editing ? t('home.widget.editDone') : t('overview.customise'),
      icon: options.editing ? <Check size={14} /> : <LayoutGrid size={14} />,
      disabled: !options.ready,
      onSelect: options.onToggleEdit,
    },
  ];

  if (addable.length > 0)
    entries.push({
      kind: 'submenu',
      id: 'add',
      label: t('home.widget.add'),
      icon: <Plus size={14} />,
      items: addable.map((id) => ({
        id: `add-${id}`,
        label: t(OVERVIEW_WIDGET_DEFS[id].labelKey),
        onSelect: () => options.onShow(id),
      })),
    });

  entries.push({
    id: 'role-default',
    label: t('overview.useRoleDefault'),
    icon: <RotateCcw size={14} />,
    disabled: !options.personalised || !options.ready,
    onSelect: options.onUseRoleDefault,
  });

  if (isAdmin) {
    entries.push(separator('admin'));
    entries.push({
      kind: 'submenu',
      id: 'set-default',
      label: t('overview.setRoleDefault'),
      icon: <UserCog size={14} />,
      items: ROLES.map((role) => ({
        id: `set-default-${role}`,
        label: t(ROLE_LABEL_KEY[role]),
        onSelect: () => options.onSaveRoleDefault(role, layout),
      })),
    });
    if (options.definedRoles.length > 0)
      entries.push({
        kind: 'submenu',
        id: 'clear-default',
        label: t('overview.clearRoleDefault'),
        icon: <UserMinus size={14} />,
        items: options.definedRoles.map((role) => ({
          id: `clear-default-${role}`,
          label: t(ROLE_LABEL_KEY[role]),
          onSelect: () => options.onSaveRoleDefault(role, null),
        })),
      });
  }

  entries.push(separator('refresh'));
  entries.push({
    id: 'refresh',
    label: t('gctx.refreshData'),
    icon: <RefreshCw size={14} />,
    onSelect: options.onRefresh,
  });

  return entries;
}
