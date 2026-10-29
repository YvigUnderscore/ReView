// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Zoom/pan arithmetic of a media layer centred in its box (video player).
 *
 * The image viewer has always zoomed from 0.1× to 20×; the video player had no zoom at all — it
 * was impossible to look closely at a rotoscopy edge or an aliasing artefact. The layer is
 * **centred** by the layout (the image is fitted to the box), so we reason in offsets from the
 * container centre: `translate(x, y) scale(s)` with a central origin. A point at `d` from the
 * centre stays under the cursor when the scale goes from `s` to `s'` if the offset is reset to
 * `d − (d − offset)·s'/s`.
 */

export interface ZoomState {
  scale: number;
  /** Offset in screen pixels, applied AFTER the scale (translate then scale). */
  x: number;
  y: number;
}

/** View fitted to the box: this is the starting state and the one where the zoom disappears. */
export const ZOOM_FIT: ZoomState = { scale: 1, x: 0, y: 0 };

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 32;

export const clampScale = (scale: number): number =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number.isFinite(scale) ? scale : 1));

/** Is the image simply fitted (neither zoomed nor panned)? */
export const isFit = (s: ZoomState): boolean => s.scale === 1 && s.x === 0 && s.y === 0;

/**
 * Zooms towards `target`, keeping fixed the point located at (`dx`, `dy`) from the container
 * centre. `dx`/`dy` in screen pixels, untransformed.
 */
export function zoomTo(state: ZoomState, target: number, dx: number, dy: number): ZoomState {
  const scale = clampScale(target);
  const k = scale / state.scale;
  if (k === 1) return state;
  return { scale, x: dx - (dx - state.x) * k, y: dy - (dy - state.y) * k };
}

/** Multiplies the current scale around the point (`dx`, `dy`) relative to the centre. */
export const zoomBy = (state: ZoomState, factor: number, dx = 0, dy = 0): ZoomState =>
  zoomTo(state, state.scale * factor, dx, dy);

/** Pans the view by (`dx`, `dy`) screen pixels. */
export const panBy = (state: ZoomState, dx: number, dy: number): ZoomState => ({
  ...state,
  x: state.x + dx,
  y: state.y + dy,
});

/** Style of the transformed layer — empty when fitted, so the render is unchanged. */
export function zoomStyle(state: ZoomState): { transform?: string; transformOrigin?: string } {
  if (isFit(state)) return {};
  return {
    transform: `translate(${state.x}px, ${state.y}px) scale(${state.scale})`,
    transformOrigin: 'center center',
  };
}

/** Factor of one wheel notch — natural direction: upward = closer. */
export const wheelFactor = (deltaY: number): number => (deltaY < 0 ? 1.15 : 1 / 1.15);

/** Displacement beyond which a drag is no longer a click (play/pause). */
export const PAN_CLICK_SLOP = 4;
