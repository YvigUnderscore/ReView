// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Box of a reference image pinned to the canvas, as fractions of the base image. */
export interface RefBox {
  x: number;
  y: number;
  width: number;
}

/** Reference image being prepared in the composer (local, sent with the comment). */
export interface StagedReference extends RefBox {
  key: string;
  dataUrl: string;
}

/**
 * Free bands around the media when it is fitted to the viewer (letterbox), as fractions of the media's
 * width/height. Measured from the aspects, hence independent of the current zoom.
 *
 * They no longer bound the gesture: a reference is placed exactly where it is dropped (`placeRefBox`).
 * They describe the zone every viewer shows at fit, and serve two things only: choosing where a paste
 * lands, and rescuing at display time an inherited position that no viewer would show (`rescueRefBox`).
 */
export interface ViewerBands {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** No known band (container not yet measured): one sticks to the media frame. */
export const NO_BANDS: ViewerBands = { left: 0, right: 0, top: 0, bottom: 0 };

export const REF_MIN_WIDTH = 0.02;
const REF_MAX_WIDTH = 1;
/** Width of a reference when pasted (fraction of the media width). */
export const REF_PASTE_WIDTH = 0.3;
/**
 * Maximum overflow allowed around the media, in image widths/heights: **mirror of the Zod bounding**
 * (`media-reference.routes.ts`). It is the only limit of the gesture: beyond it, the server would refuse
 * the reference at submission and the comment would lose it.
 */
export const REF_POS_LIMIT = 3;
/** Top band of the reference, taken as visible: its height, for its part, is unknown here. */
const REF_MIN_VISIBLE = 0.05;
/** Part of the width that must remain in the zone for the reference to be recognised. */
const REF_MIN_SHOWN = 1 / 3;
/** Breathing space between the media and a reference placed in a band. */
const REF_GAP = 0.02;
/** Offset of the following references, along the band or diagonally on the media. */
const CASCADE = 0.05;
const CORNER = 0.04;

const clamp = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : lo;

/** Usable coordinate: an unmeasured container yields a `NaN` at each `pointermove`. */
const finite = (v: number) => (Number.isFinite(v) ? v : 0);

/** Usable band: never negative, never beyond the reachable ceiling. */
const band = (v: number) => clamp(v, 0, REF_POS_LIMIT);

/** Opposite edge of a band. Without a band, a plain `0`: a `-0` survives comparisons. */
const edge = (v: number) => (v === 0 ? 0 : -v);

/**
 * Letterbox bands from the two aspects (media, zone that crops it). A media "wider" than the viewer
 * leaves top/bottom bands, a "taller" media leaves side bands. An unmeasurable aspect (zero-height
 * container) gives no band.
 */
export function fitBands(mediaAspect: number, viewportAspect: number): ViewerBands {
  const ok = (v: number) => Number.isFinite(v) && v > 0;
  if (!ok(mediaAspect) || !ok(viewportAspect)) return NO_BANDS;
  if (viewportAspect > mediaAspect) {
    const side = band((viewportAspect / mediaAspect - 1) / 2);
    return { left: side, right: side, top: 0, bottom: 0 };
  }
  const vert = band((mediaAspect / viewportAspect - 1) / 2);
  return { left: 0, right: 0, top: vert, bottom: vert };
}

/**
 * Places a reference **where it is dropped**, inside as well as outside the media frame: nothing pulls it
 * back towards the image. Only accidents are corrected: a `NaN` coming from an unmeasured container, an
 * absurd width, and overflow beyond the ceiling shared with the server (beyond it, the submission of the
 * comment would be refused: that is where the reference would be lost).
 *
 * Three "smart" bounds failed to leave the gesture free: outside the frame without limit (invisible), then
 * 0..1 (snapped automatically onto the image), then the letterbox bands, which still forbid the sides as
 * soon as the letterbox is horizontal, i.e. the common case of a wide shot. The gesture is therefore no
 * longer bounded at all; the safety net is at display time.
 */
export function placeRefBox(box: RefBox): RefBox {
  return {
    x: clamp(finite(box.x), -REF_POS_LIMIT, REF_POS_LIMIT),
    y: clamp(finite(box.y), -REF_POS_LIMIT, REF_POS_LIMIT),
    width: clamp(box.width, REF_MIN_WIDTH, REF_MAX_WIDTH),
  };
}

/** Never-empty interval: a degenerate zone must not return a `NaN`. */
const within = (v: number, lo: number, hi: number) => clamp(v, lo, Math.max(lo, hi));

/**
 * Zone that the viewer really shows, as fractions of the media: measured in pixels, hence exact at the
 * current zoom and pan. It is "the canvas" from the point of view of whoever moves a reference.
 */
export interface RefCanvas {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Without a measurement, the media frame alone serves as the canvas: this is the cautious behaviour. */
export const MEDIA_CANVAS: RefCanvas = { left: 0, top: 0, right: 1, bottom: 1 };

/**
 * Bounds a gesture to the **visible canvas**: the reference can be placed wherever one wants on it, inside
 * as well as outside the media frame, but not beyond the viewer. Pushed outside, it would become
 * ungraspable: the viewer crops what overflows, hovering included, so it could be neither taken back nor
 * deleted before the comment is sent. That is the only "must not be able to lose it", and it contradicts no
 * gesture: one never releases the pointer outside what one sees.
 *
 * `height` is the rendered height of the reference as fractions of the media height (the image is decoded,
 * so we measure it); unknown, one sticks to the graspable part.
 */
export function onCanvasRefBox(box: RefBox, height: number, canvas: RefCanvas): RefBox {
  const placed = placeRefBox(box);
  const tall = Number.isFinite(height) && height > 0 ? height : REF_MIN_VISIBLE;
  const holdX = Math.min(placed.width, REF_MIN_VISIBLE);
  const holdY = Math.min(tall, REF_MIN_VISIBLE);
  return {
    ...placed,
    x: within(placed.x, canvas.left - placed.width + holdX, canvas.right - holdX),
    y: within(placed.y, canvas.top - tall + holdY, canvas.bottom - holdY),
  };
}

/** Window of an axis: what is kept as is, and where what is out of field is brought back. */
interface Axis {
  keepLo: number;
  keepHi: number;
  safeLo: number;
  safeHi: number;
}

const rescueAxis = (v: number, a: Axis) =>
  v >= a.keepLo && v <= a.keepHi ? v : within(v, a.safeLo, a.safeHi);

/**
 * Display safety net: a reference of which enough is seen remains **exactly** where it was placed; another
 * is brought back into the zone that this viewer shows at fit (the media plus its bands). Pasting once
 * placed at x = 1.05 without bounds: such positions, outside any band, exist in the database and would
 * remain invisible.
 *
 * Reserved for **persisted** references, which can no longer be moved. Those in preparation have just been
 * released under their author's eyes: nothing reframes them.
 */
export function rescueRefBox(box: RefBox, bands: ViewerBands = NO_BANDS): RefBox {
  const { x, y, width } = placeRefBox(box);
  const minX = edge(band(bands.left));
  const maxX = 1 + band(bands.right);
  const minY = edge(band(bands.top));
  const maxY = 1 + band(bands.bottom);
  // Known width: one requires seeing a recognisable part of it. Unknown height: only the top band of the
  // reference is certain to exist, and it is that band which must remain in the zone.
  const shown = Math.min(width, Math.max(REF_MIN_VISIBLE, width * REF_MIN_SHOWN));
  return {
    x: rescueAxis(x, {
      keepLo: minX - width + shown,
      keepHi: maxX - shown,
      safeLo: minX,
      safeHi: maxX - width,
    }),
    y: rescueAxis(y, {
      keepLo: minY - REF_MIN_VISIBLE,
      keepHi: maxY - REF_MIN_VISIBLE,
      safeLo: minY,
      safeHi: maxY - REF_MIN_VISIBLE,
    }),
    width,
  };
}

/**
 * Position of a reference just pasted: **beside** the media as soon as a letterbox band can host it
 * (comparing presupposes seeing both images), otherwise on a corner of the media, the only visible place
 * when the media fills the viewer. The gesture no longer being bounded, this position is only a starting point.
 *
 * A side band is judged on its width, which is known. Lacking the height of the reference (the image is not
 * decoded at paste time), a top/bottom band is judged on that same width: exact for a square media, a little
 * optimistic for a wide shot. Subsequent pastes cascade along the retained band.
 */
export function pastedRefBox(index: number, bands: ViewerBands = NO_BANDS): RefBox {
  const width = REF_PASTE_WIDTH;
  const need = width + 2 * REF_GAP;
  const fits = (v: number) => band(v) >= need;
  const along = REF_GAP + index * CASCADE;
  if (fits(bands.right) || fits(bands.left)) {
    const x = fits(bands.right) ? 1 + REF_GAP : -(width + REF_GAP);
    return placeRefBox({ x, y: along, width });
  }
  if (fits(bands.bottom) || fits(bands.top)) {
    const y = fits(bands.bottom) ? 1 + REF_GAP : -(width + REF_GAP);
    return placeRefBox({ x: along, y, width });
  }
  return placeRefBox({ x: 0.06 + index * CORNER, y: 0.08 + index * CORNER, width });
}
