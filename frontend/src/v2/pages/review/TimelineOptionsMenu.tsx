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

/** Display toggle offered on right-click (waveform, chaining). */
export interface TimelineToggle {
  available: boolean;
  enabled: boolean;
  onToggle: () => void;
}

/**
 * Right-click menu of the transport bar — the entry point to the player settings.
 *
 * The project's "simple UI" rule also applies to the playbar: the waveform and automatic
 * chaining are set here, not in two more buttons above the timeline. With no entry available,
 * the bar is rendered bare — an empty menu on right-click is worth less than the viewer's
 * menu, which then takes over.
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
  /** Audio waveform of the media — absent when it has no sound. */
  waveform?: TimelineToggle;
  /** Playlist chaining — absent outside a playlist context. */
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
