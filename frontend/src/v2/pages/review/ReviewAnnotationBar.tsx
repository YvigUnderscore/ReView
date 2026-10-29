// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { EyeOff } from 'lucide-react';
import type { useAnnotations } from './useAnnotations';
import { useT } from '../../i18n';

/**
 * Pill placements. Anchored to `viewer`, it lives **inside the media area** (bottom,
 * centered): it is the only edge no viewer surface already occupies — the status banners
 * (placing a point, a scene proposed by a comment) hold the top center, the render menus the
 * top-left corner, the zoom guides the bottom-right. It is also closest to the comment
 * thread, where you came from and where you go back to write.
 *
 * `page` is the old anchor, relative to the block wrapping the viewer: it remains the one
 * for the video player and the client share, whose media area does not yet host the pill.
 */
const ANCHOR = {
  viewer: 'bottom-3 left-1/2 -translate-x-1/2',
  page: 'left-1/2 top-2 -translate-x-1/2',
} as const;

/**
 * Floating "Hide annotation" pill, shown while a comment's annotation is visible — reachable
 * without taking your eyes off the image, and dismissable with Escape too. The drawing tools
 * used to live under the comment field; since the chrome rework they live in the rail and
 * the options bar.
 *
 * It used to sit in the review section, whose first child is the chrome's unified header:
 * the pill landed **on the mode toggle** (also centered) or on the instruction strip. Hence
 * the anchoring: inside the viewer, at the same spot for the image, the 3D model and the
 * point cloud.
 */
export default function ReviewAnnotationBar({
  ann,
  onClearSelection,
  anchor = 'page',
}: {
  ann: ReturnType<typeof useAnnotations>;
  onClearSelection: () => void;
  /** Container that hosts the pill — `viewer` once the media area receives it. */
  anchor?: keyof typeof ANCHOR;
}) {
  const t = useT();
  // Points of interest count as much as the drawing: since they survive a view movement
  // (they are anchored in the scene), they are even what stays on screen the longest —
  // without them in this condition, playing a comment would have no exit.
  const visible = !!ann.viewed || ann.viewedPoi.length > 0;
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onClearSelection]);

  if (!visible) return null;
  return (
    <div className={`pointer-events-none absolute z-30 ${ANCHOR[anchor]}`}>
      <button
        onClick={onClearSelection}
        title={t('review.annotation.hide')}
        className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-1.5 text-sm shadow-lg backdrop-blur hover:bg-secondary"
      >
        <EyeOff size={14} /> {t('ctx.hideAnnotation')}
      </button>
    </div>
  );
}
