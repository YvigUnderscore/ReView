// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useLayoutEffect, useState, type RefObject } from 'react';

/** Drawing box of the guides: layout size (CSS px) and on-screen scale. */
export interface GuideBox {
  w: number;
  h: number;
  /** Cumulative scale factor of the transformed ancestors (player zoom): 1 = fitted. */
  scale: number;
}

/**
 * Fallback box when nothing is measurable (rendering outside a browser, zero-size container).
 * The aspect hardly matters since nothing is visible, but the SVG stays consistent.
 */
export const FALLBACK_GUIDE_BOX: GuideBox = { w: 1920, h: 1080, scale: 1 };

/** Below this threshold, a scale change does not alter a stroke by one pixel: it is ignored. */
const SCALE_STEP = 1000;

/**
 * Measures the box of the overlay **and the scale of the zoomed layer that carries it**.
 *
 * The guide overlay lives in the player's transformed layer (`translate(...) scale(...)` of the
 * video zoom, as in the image viewer): everything it draws is multiplied by the scale, strokes
 * included, so the guides thickened when zooming. `vector-effect: non-scaling-stroke` cannot help
 * there: it neutralises the **internal** transform of the SVG (viewBox → viewport), not a CSS
 * transform set on an HTML ancestor.
 *
 * The scale is read by comparing the screen rectangle (`getBoundingClientRect`, which includes the
 * transforms) with the layout size (`offsetWidth`, which ignores them). No event signals a change
 * of transform, and in the image viewer the zoom does not even cause the overlay to render (pinned
 * element, stable identity). So we read on every frame, only while a guide is displayed, which is
 * not the case by default.
 */
export function useGuideBox(ref: RefObject<HTMLElement | null>, enabled: boolean): GuideBox {
  const [box, setBox] = useState<GuideBox>(FALLBACK_GUIDE_BOX);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let raf = 0;
    const tick = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w > 0 && h > 0) {
        const rect = el.getBoundingClientRect();
        const measured = rect.width > 0 ? rect.width / w : 1;
        const scale = Math.round(measured * SCALE_STEP) / SCALE_STEP || 1;
        setBox((prev) => (prev.w === w && prev.h === h && prev.scale === scale ? prev : { w, h, scale }));
      }
      raf = requestAnimationFrame(tick);
    };
    // First synchronous reading, before paint: the guides are born already at the right size.
    tick();
    return () => cancelAnimationFrame(raf);
  }, [ref, enabled]);

  return box;
}
