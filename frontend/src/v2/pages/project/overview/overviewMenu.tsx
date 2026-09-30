// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Check, LayoutGrid, Plus, RefreshCw, RotateCcw, UserCog, UserMinus } from 'lucide-react';
import { separator, type MenuEntry } from '../../../lib/menuSpec';
import { ROLE_LABEL_KEY } from '../../../lib/userStatus';
import type { WidgetsPref } from '../../../lib/widgetLayout';
import type { Role } from '../../../types/api';
import type { Tr } from '../../../i18n';
import { OVERVIEW_WIDGET_DEFS, addableOverviewWidgets, type OverviewWidgetId } from './overviewWidgets';

/**
 * Le menu contextuel de la vue d'ensemble — tout ce qu'on peut faire à la page se fait ici.
 *
 * La règle du projet veut qu'une action passe par le clic droit avant d'obtenir un bouton :
 * une page qui se compose n'a donc pas de barre d'outils, elle a un menu. Seule la bascule
 * « personnaliser » a droit à une icône, parce qu'un menu qu'on ne soupçonne pas n'existe
 * pas.
 *
 * Les entrées d'administration ne sont pas un décor réservé : le serveur refuse l'écriture
 * à quiconque n'est pas administrateur du studio (`requireRole(ADMIN)`).
 */

const ROLES: Role[] = ['ADMIN', 'SUPERVISOR', 'ARTIST', 'CLIENT'];

export interface OverviewMenuOptions {
  t: Tr;
  editing: boolean;
  ready: boolean;
  layout: WidgetsPref;
  /** Vrai si la personne a elle-même réglé sa page : sinon, rien à remettre au défaut. */
  personalised: boolean;
  canManage: boolean;
  isAdmin: boolean;
  /** Rôles pour lesquels l'administration a déjà enregistré un défaut. */
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
