// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Loader2 } from 'lucide-react';
import ZoomBadge from './zoom/ZoomBadge';
import type { ViewportZoom } from './zoom/useViewportZoom';
import { useT } from '../../i18n';

/**
 * Repères flottants du lecteur vidéo : taux de zoom (à gauche), vitesse de lecture (à
 * droite), chargement en cours (en bas). Tous n'apparaissent qu'au moment utile — un
 * lecteur au repos, en lecture normale et ajusté n'affiche rien du tout.
 */
export default function ViewerBadges({
  zoom,
  playbackSpeed,
  buffering,
  switchingQuality,
}: {
  zoom: ViewportZoom;
  /** Vitesse courante (34.C) : négative en lecture arrière, masquée à ×1. */
  playbackSpeed: { visible: boolean; speed: number };
  buffering: boolean;
  switchingQuality: boolean;
}) {
  const t = useT();
  return (
    <>
      <ZoomBadge zoom={zoom} />
      {playbackSpeed.visible && (
        <div className="pointer-events-none absolute right-3 top-3 z-30 rounded-md bg-black/60 px-2 py-1 font-mono text-xs text-white backdrop-blur">
          {playbackSpeed.speed < 0 ? '◀' : '▶'} ×{Math.abs(playbackSpeed.speed)}
        </div>
      )}
      {(buffering || switchingQuality) && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-30 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-xs text-white backdrop-blur">
          <Loader2 size={13} className="animate-spin" />
          {switchingQuality ? t('video.qualitySwitch') : t('common.loading')}
        </div>
      )}
    </>
  );
}
