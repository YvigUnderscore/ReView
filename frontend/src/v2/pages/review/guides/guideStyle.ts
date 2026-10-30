// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The **single** visual language of the review guides: thirds, centre cross, safe areas and the
 * border of the delivery frame (letterbox) share their stroke, colour and shadow from here. The
 * values used to be hard-coded in each JSX, hence thicknesses and colours that diverged from one
 * guide to the next.
 *
 * All lengths are expressed in **screen pixels**: the guides are drawn in an SVG whose `viewBox`
 * is in CSS pixels of its own box, and the helpers divide by the scale of the zoomed layer. A
 * stroke therefore stays 1 px on screen whether the player is fitted or at 16×.
 */

/** Thickness of all guide strokes, in screen pixels. */
export const GUIDE_STROKE_PX = 1;

/**
 * Test-card white. **Deliberate exception to the theme tokens**: a framing guide is a convention
 * of test cards (like a slate or a leader), not an interface colour. It must stay identical in
 * light and dark themes, above a media whose brightness is unknown. Its legibility comes from the
 * drop shadow, not from a theme token.
 */
export const GUIDE_COLOR = '#ffffff';

/** Stroke opacity: pure white, but not aggressive above the image. */
export const GUIDE_OPACITY = 0.8;

/** Drop shadow: it is what separates the stroke from a light background. */
export const GUIDE_SHADOW_COLOR = '#000000';
export const GUIDE_SHADOW_OPACITY = 0.6;
/** Standard deviation of the blur, in screen pixels. */
export const GUIDE_SHADOW_BLUR_PX = 0.8;
/** Vertical offset of the shadow, in screen pixels. */
export const GUIDE_SHADOW_DY_PX = 0.5;

/** Dashes (title guide), in screen pixels: stroke, then gap. */
export const GUIDE_DASH_PX: readonly [number, number] = [6, 4];

/** Veil over the areas outside the delivery frame (letterbox). */
export const GUIDE_SCRIM_OPACITY = 0.4;

/** "Action" safe area: 90% of the frame. */
export const ACTION_SAFE_RATIO = 0.9;
/** "Title" safe area: 80% of the frame. */
export const TITLE_SAFE_RATIO = 0.8;
/** Half-length of an arm of the centre cross, as a fraction of the smaller side. */
export const CENTER_CROSS_RATIO = 0.04;

/** Scale of the zoomed layer, brought back to a usable value (safeguard). */
export const guideScale = (scale: number): number => (Number.isFinite(scale) && scale > 0 ? scale : 1);

/** Thickness in `viewBox` units (CSS pixels) to obtain `GUIDE_STROKE_PX` on screen. */
export const guideStrokeWidth = (scale: number): number => GUIDE_STROKE_PX / guideScale(scale);

/** Dash pattern compensated for zoom: same apparent length at every scale. */
export const guideDashArray = (scale: number): string =>
  GUIDE_DASH_PX.map((v) => v / guideScale(scale)).join(' ');

/** Shadow blur, compensated for zoom. */
export const guideShadowBlur = (scale: number): number => GUIDE_SHADOW_BLUR_PX / guideScale(scale);

/** Shadow offset, compensated for zoom. */
export const guideShadowDy = (scale: number): number => GUIDE_SHADOW_DY_PX / guideScale(scale);

/**
 * Stroke attributes set **once**, on the group that carries all the guides: `stroke`,
 * `stroke-width` and `stroke-opacity` are inherited by the children, which therefore carry only
 * their geometry. This is the single point that guarantees uniformity.
 */
export interface GuideStrokeProps {
  fill: 'none';
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  strokeLinecap: 'butt';
}

export const guideStrokeProps = (scale: number): GuideStrokeProps => ({
  fill: 'none',
  stroke: GUIDE_COLOR,
  strokeWidth: guideStrokeWidth(scale),
  strokeOpacity: GUIDE_OPACITY,
  strokeLinecap: 'butt',
});
