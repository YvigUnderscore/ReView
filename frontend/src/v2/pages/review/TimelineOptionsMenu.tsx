// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Bookmark } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../../components/ui/context-menu';
import { useT } from '../../i18n';

/** Bascule d'affichage proposée au clic droit (forme d'onde, enchaînement). */
export interface TimelineToggle {
  available: boolean;
  enabled: boolean;
  onToggle: () => void;
}

/**
 * Menu clic droit de la barre de transport — la porte d'entrée des réglages du lecteur.
 *
 * La règle « UI simple » du projet vaut aussi pour la playbar : la forme d'onde et
 * l'enchaînement automatique se règlent ici, pas dans deux boutons de plus au-dessus de
 * la timeline. Sans aucune entrée disponible, la barre est rendue nue — un menu vide au
 * clic droit vaut moins que le menu du viewer, qui reprend alors la main.
 */
export default function TimelineOptionsMenu({
  children,
  canAddMarker,
  onAddMarker,
  waveform,
  autoAdvance,
}: {
  children: ReactNode;
  canAddMarker: boolean;
  onAddMarker: () => void;
  /** Forme d'onde audio du média — absente quand il n'a pas de son. */
  waveform?: TimelineToggle;
  /** Enchaînement de la playlist — absent hors contexte de playlist. */
  autoAdvance?: TimelineToggle;
}) {
  const t = useT();
  const toggles = [
    waveform?.available ? ({ key: 'waveform', label: t('video.waveform.show'), ...waveform } as const) : null,
    autoAdvance?.available
      ? ({ key: 'advance', label: t('playlist.autoAdvance'), ...autoAdvance } as const)
      : null,
  ].filter((e) => e !== null);

  if (!canAddMarker && toggles.length === 0) return <>{children}</>;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {canAddMarker && (
          <ContextMenuItem onClick={onAddMarker}>
            <Bookmark size={14} /> {t('video.addMarkerHere')}
          </ContextMenuItem>
        )}
        {canAddMarker && toggles.length > 0 && <ContextMenuSeparator />}
        {toggles.map((e) => (
          <ContextMenuCheckboxItem key={e.key} checked={e.enabled} onCheckedChange={e.onToggle}>
            {e.label}
          </ContextMenuCheckboxItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
