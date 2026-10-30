// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Minimize2 } from 'lucide-react';
import { useT } from '@/v2/i18n';
import type { ViewportZoom } from './useViewportZoom';

/**
 * Zoom badge of the video player: renders nothing while the image is fitted, otherwise shows the
 * current rate and a one-click return to fit. It lives **outside** the transformed layer — it is
 * the way out when the view is lost deep inside an enlargement.
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
