// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState, type RefObject } from 'react';
import { MEDIA_CANVAS, NO_BANDS, fitBands, type RefCanvas, type ViewerBands } from './referenceBox';

/** `overflow` value that clips. Empty = property not computed: treated as `visible`. */
const clips = (value: string) => value !== '' && value !== 'visible';

/** First ancestor that clips what overflows: it decides what we see. */
function clipAncestor(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const style = getComputedStyle(p);
    if (clips(style.overflow) || clips(style.overflowX) || clips(style.overflowY)) return p;
  }
  return null;
}

/**
 * Area the viewer shows, **in fractions of the media** and at the current zoom: enough to bound a
 * reference's move to the visible canvas without bounding it to the image frame. Measured on each
 * gesture (zoom and pan trigger no observer: they only change a transform). Nothing measurable ⇒ the
 * media's frame, cautiously.
 */
export function viewerCanvas(layer: HTMLElement): RefCanvas {
  const media = layer.getBoundingClientRect();
  const clip = (clipAncestor(layer) ?? layer).getBoundingClientRect();
  if (!(media.width > 0) || !(media.height > 0)) return MEDIA_CANVAS;
  const zone = {
    left: (clip.left - media.left) / media.width,
    top: (clip.top - media.top) / media.height,
    right: (clip.right - media.left) / media.width,
    bottom: (clip.bottom - media.top) / media.height,
  };
  return Object.values(zone).every((v) => Number.isFinite(v)) ? zone : MEDIA_CANVAS;
}

const same = (a: ViewerBands, b: ViewerBands) =>
  a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom;

/**
 * Free bands around the media in the viewer, measured from the **aspects** of the media and of the
 * area that clips it. Going through aspects rather than the two boxes makes the measurement independent
 * of zoom: the catch-up of inherited positions would not happen on the first wheel notch (the zoomed
 * media then overflows the viewer, and any band measured in pixels would be zero). These bands bound no
 * gesture: a reference is placed where it is dropped.
 *
 * `mediaRef` designates a layer that matches the media (`absolute inset-0` of its plane). Nothing
 * measurable (container without height, no clipping ancestor) ⇒ no band, hence the media's frame as the
 * sole area: that is the cautious behavior.
 */
export function useViewerBands(mediaRef: RefObject<HTMLElement | null>): ViewerBands {
  const [bands, setBands] = useState<ViewerBands>(NO_BANDS);

  useEffect(() => {
    const el = mediaRef.current;
    const viewport = el && clipAncestor(el);
    if (!el || !viewport) return;
    const measure = () => {
      const media = el.getBoundingClientRect();
      const clip = viewport.getBoundingClientRect();
      const next = fitBands(media.width / media.height, clip.width / clip.height);
      // Same object if nothing moved: otherwise every impulse of the observer would render the
      // references layer for nothing.
      setBands((prev) => (same(prev, next) ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(viewport);
    return () => ro.disconnect();
  }, [mediaRef]);

  return bands;
}
