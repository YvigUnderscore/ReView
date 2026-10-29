// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Line2 } from 'three/addons/lines/Line2.js';
import type { SplatPaintStroke } from '../../reviewTypes';
import type { LineModules } from './lineModules';
import { attachStrokeFrame } from './strokeFrame';
import type { PaintSceneHandle } from './surfaceRay';
import { strokeCenter, type Vec3 } from './surfaceTrace';

/**
 * Strokes of the 3D surface brush: (de)serialization from the `Comment.annotation` array (typed
 * parts, like the hotspots) and construction of the 3D line, **child of the painted object**
 * (object space, so it follows the media transform): the cloud on the splat side, the root group
 * on the model side.
 *
 * The part type stays `splat-paint` although the brush serves both spatial types: it is a
 * discriminator **written in the existing comments**, and renaming it would silence all the
 * strokes already sent. The server's Zod schema (`lib/commentPayload`) does not look at the media
 * type either.
 *
 * The thickness is in **screen pixels**: `LineMaterial` keeps it constant whatever the zoom
 * (cf. `lineModules`), whereas the former tube in world units grew when approaching and vanished
 * when receding. Strokes from before this change keep their numbers: they used to be 1 to 5
 * "relative", they are now 1 to 5 pixels, which is roughly the same stroke on screen.
 */

/**
 * Bounds of the thickness, in screen pixels: **the same unit as the cursor ring** of the overlay
 * and as the options bar field. `linewidth` is a width in pixels when `worldUnits` is false, and
 * `strokeFrame` gives the material the resolution in CSS pixels. What one sets is therefore
 * exactly what one sees under the pointer.
 *
 * The ceiling went from 16 to 32 px (lot 13): wrapping a whole object in a wide plane required a
 * thicker stroke than the brush accepted.
 */
export const MIN_STROKE_PX = 1;
export const MAX_STROKE_PX = 32;
export const DEFAULT_STROKE_PX = 3;

/** Thickness brought back within the bounds: a stroke read back can be neither zero nor excessive. */
export function clampStrokeWidth(width: unknown): number {
  const value = typeof width === 'number' && Number.isFinite(width) ? width : DEFAULT_STROKE_PX;
  return Math.min(MAX_STROKE_PX, Math.max(MIN_STROKE_PX, value));
}

/** Finite triplet, or `null`: the normal is optional (strokes from before occlusion). */
function readVec3(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [x, y, z] = value;
  if (![x, y, z].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return [x as number, y as number, z as number];
}

/**
 * Extracts the valid strokes from a comment annotation array (pure). The strokes are
 * **normalized** on the way: thickness bounded, normal absent if unreadable. The renderer no
 * longer has to defend against what an earlier version wrote.
 */
export function decodeStrokes(annotation: unknown): SplatPaintStroke[] {
  if (!Array.isArray(annotation)) return [];
  const strokes: SplatPaintStroke[] = [];
  for (const part of annotation) {
    if (!part || typeof part !== 'object') continue;
    const candidate = part as { type?: unknown; points?: unknown; color?: unknown; normal?: unknown };
    if (candidate.type !== 'splat-paint' || typeof candidate.color !== 'string') continue;
    const points = candidate.points;
    if (
      !Array.isArray(points) ||
      points.length < 6 ||
      points.length % 3 !== 0 ||
      !points.every((v) => typeof v === 'number' && Number.isFinite(v))
    )
      continue;
    const normal = readVec3(candidate.normal);
    strokes.push({
      type: 'splat-paint',
      points: points as number[],
      color: candidate.color,
      width: clampStrokeWidth((candidate as { width?: unknown }).width),
      ...(normal ? { normal } : {}),
    });
  }
  return strokes;
}

/**
 * Builds the 3D line of a stroke (to add as a child of the painted object).
 *
 * `frustumCulled` is left false: the bounding sphere of a `LineGeometry` ignores the screen
 * thickness, and a stroke grazing the edge of the frame would vanish at once.
 *
 * Two settings keep the stroke on a **real surface**, which the cloud did not require:
 *
 *  - `polygonOffset` brings the stroke closer to the eye in the depth buffer. A stroke painted
 *    exactly on a mesh is coplanar with it: without this offset, it fights it in z and comes out
 *    as flickering dashes. The cloud does not write depth, so the setting has no effect there.
 *  - `raycast` becomes inert: the strokes are children of the painted object, and the brush ray
 *    descends the hierarchy on a model. Without this, painting over an existing stroke would snap
 *    to the stroke instead of the surface. The eraser measures on screen and needs no ray.
 */
export function buildStrokeLine(
  handle: PaintSceneHandle,
  lines: LineModules,
  stroke: SplatPaintStroke,
): Line2 {
  const geometry = new lines.LineGeometry();
  geometry.setPositions(stroke.points);
  const material = new lines.LineMaterial({
    color: stroke.color,
    linewidth: clampStrokeWidth(stroke.width),
    // Thickness in screen pixels; the resolution is given on every frame by `strokeFrame`.
    worldUnits: false,
    // Approximate occlusion modulates the opacity: without transparency it would have no effect.
    transparent: true,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const line = new lines.Line2(geometry, material);
  line.renderOrder = 5; // above the splats (which do not write depth)
  line.frustumCulled = false;
  line.raycast = () => {};
  attachStrokeFrame(line, handle, stroke.normal ?? null, strokeCenter(stroke.points));
  return line;
}

/** Frees a stroke line (geometry and material) and removes it from the scene. */
export function disposeStrokeLine(line: Line2): void {
  line.onBeforeRender = () => {};
  line.geometry.dispose();
  line.material.dispose();
  line.removeFromParent();
}
