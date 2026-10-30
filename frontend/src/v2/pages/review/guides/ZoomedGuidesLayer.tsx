// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CSSProperties } from 'react';
import CompositionGuides from '../CompositionGuides';
import type { FitBox } from '../zoom/useFitBox';

/**
 * Composition guides placed in a SEPARATE layer, above the A/B comparison.
 *
 * They used to live in the media layer. That layer carries the zoom transform, which makes it a
 * stacking context: its internal `z-index` no longer applies outside it. The comparison overlay,
 * a sibling rendered AFTER it, therefore covered everything, guides included, which disappeared
 * as soon as a wipe or a difference was opened.
 *
 * Hence this third layer, also a sibling, rendered last: it replays the geometry of the media
 * layer (same box, same transform, same centering) so that the guides land on the image rather
 * than on the player area, and it captures no pointer events.
 */
export default function ZoomedGuidesLayer({
  box,
  zoomStyle,
}: {
  box: FitBox | null;
  zoomStyle: CSSProperties;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div
        className="relative"
        style={{
          ...(box ? { width: box.w, height: box.h } : { maxWidth: '100%', maxHeight: '100%' }),
          ...zoomStyle,
        }}
      >
        <CompositionGuides />
      </div>
    </div>
  );
}
