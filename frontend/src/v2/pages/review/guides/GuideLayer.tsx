// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId, type CSSProperties, type ReactNode } from 'react';
import {
  GUIDE_SHADOW_COLOR,
  GUIDE_SHADOW_OPACITY,
  guideShadowBlur,
  guideShadowDy,
  guideStrokeProps,
} from './guideStyle';

/**
 * SVG layer common to **all** review guides (composition and delivery frame). It sets the
 * `viewBox` in CSS pixels of its own box (one unit = one pixel, uniform scaling), the drop
 * shadow, and the only group that carries the stroke. Children only provide their geometry:
 * they inherit colour, thickness and opacity, and so can no longer diverge.
 */
export default function GuideLayer({
  w,
  h,
  scale = 1,
  className,
  style,
  children,
}: {
  /** Box width, in CSS pixels (layout, excluding zoom). */
  w: number;
  /** Box height, in CSS pixels (layout, excluding zoom). */
  h: number;
  /** Scale of the transformed ancestor: lengths are divided by it. */
  scale?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  // Unique identifier per instance: two players shown side by side (multi-grid, A/B comparison)
  // would otherwise define two filters with the same `id`, and the second would reuse the blur
  // of the first, hence the shadow computed for another zoom.
  // `useId` wraps its identifier in punctuation (`:r0:`, `«r0»` depending on the React version):
  // we keep only alphanumerics, the only safe set inside a `url(#…)`.
  const filterId = `review-guide-shadow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const blur = guideShadowBlur(scale);
  const dy = guideShadowDy(scale);
  const stroke = guideStrokeProps(scale);
  // Filter region in user units: a bbox of zero height (a single stroke) would make the region
  // null, and the browser would display nothing at all.
  const margin = blur * 4 + dy + stroke.strokeWidth;

  return (
    <svg
      className={className}
      viewBox={`0 0 ${w} ${h}`}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <filter
          id={filterId}
          filterUnits="userSpaceOnUse"
          x={-margin}
          y={-margin}
          width={w + margin * 2}
          height={h + margin * 2}
        >
          <feDropShadow
            dx={0}
            dy={dy}
            stdDeviation={blur}
            floodColor={GUIDE_SHADOW_COLOR}
            floodOpacity={GUIDE_SHADOW_OPACITY}
          />
        </filter>
      </defs>
      <g {...stroke} filter={`url(#${filterId})`}>
        {children}
      </g>
    </svg>
  );
}
