// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_REVIEW_ASPECT, reviewFrame, type FrameRect } from './frameRect';
import GuideLayer from './guides/GuideLayer';
import { outlineRect } from './guides/guideGeometry';
import { GUIDE_SCRIM_OPACITY, guideStrokeWidth } from './guides/guideStyle';

/**
 * Review frame (Phase 25 — full-space viewer). The children (WebGL canvas + HUD) fill the
 * WHOLE container; the **delivery frame** (fixed aspect from the presentation) is shown as a
 * **letterbox guide** (out-of-frame areas darkened + a border line). Elements passed as
 * `frame` (annotation overlay) are anchored to the guide: normalized annotations 0..1 stay
 * aligned for every screen — the frame no longer resizes with the window (the camera is
 * extended to the container by `setViewOffset`, see `resizeRendererCamera`).
 *
 * The border line shares the visual language of the composition guides (`guides/guideStyle`):
 * same white, same thickness, same drop shadow — it previously had its own CSS border.
 */
export default function ReviewFrame({
  aspect = DEFAULT_REVIEW_ASPECT,
  children,
  frame,
}: {
  aspect?: number;
  children: ReactNode;
  /** Content anchored to the delivery frame (2D annotation overlay). */
  frame?: ReactNode;
}) {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : DEFAULT_REVIEW_ASPECT;
  const outerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const guide: FrameRect | null = size ? reviewFrame(a, size.w, size.h) : null;
  const showGuide = !!guide && !!size && (guide.width < size.w - 1 || guide.height < size.h - 1);
  // Veil over the out-of-frame areas — same value for the four bands, from the constants.
  const scrim = { backgroundColor: `rgb(0 0 0 / ${GUIDE_SCRIM_OPACITY})` };

  return (
    <div ref={outerRef} className="relative h-full w-full">
      {/* Full-space viewer */}
      <div className="absolute inset-0">{children}</div>

      {/* Letterbox guide: darkened out-of-frame + delivery frame border line */}
      {showGuide && guide && size && (
        <div className="pointer-events-none absolute inset-0 z-[5]">
          <div className="absolute left-0 top-0 w-full" style={{ ...scrim, height: guide.top }} />
          <div
            className="absolute bottom-0 left-0 w-full"
            style={{ ...scrim, height: size.h - guide.top - guide.height }}
          />
          <div
            className="absolute left-0"
            style={{ ...scrim, top: guide.top, height: guide.height, width: guide.left }}
          />
          <div
            className="absolute right-0"
            style={{
              ...scrim,
              top: guide.top,
              height: guide.height,
              width: size.w - guide.left - guide.width,
            }}
          />
          {/* Delivery frame border line: no transformed ancestor here (the 3D/splat zoom
              goes through the camera), so the layer's scale is 1. */}
          <GuideLayer
            w={guide.width}
            h={guide.height}
            className="absolute"
            style={{ left: guide.left, top: guide.top, width: guide.width, height: guide.height }}
          >
            <rect {...outlineRect(guide.width, guide.height, guideStrokeWidth(1))} data-guide="frame" />
          </GuideLayer>
        </div>
      )}

      {/* Content anchored to the delivery frame (annotations) */}
      {frame && (
        <div
          className="absolute z-[6]"
          style={
            guide
              ? { left: guide.left, top: guide.top, width: guide.width, height: guide.height }
              : { inset: 0 }
          }
        >
          {frame}
        </div>
      )}
    </div>
  );
}
