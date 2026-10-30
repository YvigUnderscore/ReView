// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef } from 'react';
import { useGuides } from '../../stores/useGuides';
import GuideLayer from './guides/GuideLayer';
import { actionSafeRect, centerCrossSegments, thirdsLines, titleSafeRect } from './guides/guideGeometry';
import { guideDashArray } from './guides/guideStyle';
import { useGuideBox } from './guides/useGuideBox';

/**
 * Composition guides (34.G): thirds, central cross, action (90 %) and title (80 %) safe
 * areas — SVG overlaid on the media frame (`pointer-events-none`), toggled from the review's
 * right-click menu.
 *
 * All styling comes from `guides/guideStyle` (same strokes as the delivery frame border),
 * the geometry from `guides/guideGeometry` (square cross whatever the aspect ratio), and
 * the stroke width is compensated for the player zoom: 1 px on screen, at every scale.
 */
export default function CompositionGuides() {
  const guides = useGuides((s) => s.guides);
  const ref = useRef<HTMLDivElement>(null);
  const on = guides.thirds || guides.center || guides.actionSafe || guides.titleSafe;
  const { w, h, scale } = useGuideBox(ref, on);
  if (!on) return null;

  const [crossH, crossV] = centerCrossSegments(w, h);
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-20">
      <GuideLayer w={w} h={h} scale={scale} className="h-full w-full">
        {guides.thirds &&
          thirdsLines(w, h).map((l, i) => <line key={`third-${i}`} {...l} data-guide="thirds" />)}
        {guides.center && (
          <>
            <line {...crossH} data-guide="center" />
            <line {...crossV} data-guide="center" />
          </>
        )}
        {guides.actionSafe && <rect {...actionSafeRect(w, h)} data-guide="actionSafe" />}
        {/* The title guide is distinguished by its dashes, never by its thickness. */}
        {guides.titleSafe && (
          <rect {...titleSafeRect(w, h)} strokeDasharray={guideDashArray(scale)} data-guide="titleSafe" />
        )}
      </GuideLayer>
    </div>
  );
}
