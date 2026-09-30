// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Minimize2 } from 'lucide-react';
import { useT } from '../../../i18n';
import type { ViewportZoom } from './useViewportZoom';

/**
 * Repère de zoom du lecteur vidéo : rien tant que l'image est ajustée, sinon le taux
 * courant et un retour à l'ajustement d'un clic. Il vit **hors** du calque transformé —
 * c'est la porte de sortie quand la vue est perdue au fond d'un agrandissement.
 */
export default function ZoomBadge({ zoom }: { zoom: ViewportZoom }) {
  const t = useT();
  if (zoom.fit) return null;
  return (
    <button
      onClick={zoom.reset}
      title={t('video.zoom.reset')}
      aria-label={t('video.zoom.reset')}
      className="absolute left-3 top-3 z-40 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 font-mono text-xs text-white backdrop-blur hover:bg-black/80"
    >
      {Math.round(zoom.state.scale * 100)}%
      <Minimize2 size={12} />
    </button>
  );
}
