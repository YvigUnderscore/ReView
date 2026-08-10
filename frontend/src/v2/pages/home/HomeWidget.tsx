// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, EyeOff } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../../components/ui/context-menu';
import { HOME_WIDGETS, type HomeWidgetId } from './homeWidgets';
import { useT } from '../../i18n';

/**
 * Enveloppe d'un bloc de l'Accueil : le clic droit sur le bloc propose de le masquer
 * ou de le déplacer dans sa colonne. `stopPropagation` sur le conteneur : une fois le
 * menu du bloc ouvert (Radix a déjà traité l'événement), le menu du fond de page ne
 * doit pas s'ouvrir par-dessus.
 */
export default function HomeWidget({
  id,
  canUp,
  canDown,
  onHide,
  onMove,
  children,
}: {
  id: HomeWidgetId;
  canUp: boolean;
  canDown: boolean;
  onHide: (id: HomeWidgetId) => void;
  onMove: (id: HomeWidgetId, dir: -1 | 1) => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div onContextMenu={(e) => e.stopPropagation()}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div>{children}</div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem disabled={!canUp} onSelect={() => onMove(id, -1)}>
            <ArrowUp size={14} /> {t('home.widget.moveUp')}
          </ContextMenuItem>
          <ContextMenuItem disabled={!canDown} onSelect={() => onMove(id, 1)}>
            <ArrowDown size={14} /> {t('home.widget.moveDown')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => onHide(id)}>
            <EyeOff size={14} /> {t('home.widget.hide', { name: t(HOME_WIDGETS[id].labelKey) })}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
