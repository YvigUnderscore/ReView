// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Geometry of the 3D surface brush: **pure** functions, without Three. This is where what makes a
 * stroke is decided, and this is where it gets tested.
 *
 * Two problems are handled here:
 *
 *  1. **The straight rope.** A gesture that crosses a hole in the cloud (or jumps from an object to
 *     the background of the scene) touched two very distant surfaces, and the stroke joined them
 *     with a floating segment in the void. `breaksRun` compares the actual displacement in world
 *     space to the *expected* displacement for the screen step covered at this depth: beyond a
 *     factor, the two samples are no longer on the same surface and the stroke is cut.
 *  2. **The back face.** `runNormal` averages the point → camera directions of the gesture: painted
 *     on the face one is looking at, it serves as an approximate normal to fade the stroke when
 *     orbiting around the cloud (cf. `strokeFrame`).
 *
 * `pickStroke` serves the eraser: the stroke closest to the click, measured **on screen** on the
 * projected polylines. There is no raycast, hence no dependency on rendering.
 */

export type Vec3 = [number, number, number];

/** A sample of the gesture: the surface point touched and what is needed to judge it. */
export interface SurfaceSample {
  /** Point touched in world space: distances are compared there. */
  world: Vec3;
  /** The same point in the SplatMesh object space: this is what is stored in the stroke. */
  object: Vec3;
  /** Camera to point distance at the time of the gesture. */
  depth: number;
  /** Screen step (px) from the previous sample of the gesture (0 for the first). */
  screenStep: number;
  /** Point to camera direction in object space, normalized. */
  toCamera: Vec3;
}

/**
 * Beyond this multiple of the expected displacement, two neighbouring samples are no longer on the
 * same surface. Deliberately loose: a surface seen at an angle advances quickly in depth without
 * being a hole, and cutting a stroke by mistake is more visible than leaving a short rope.
 */
export const HOLE_JUMP_FACTOR = 6;

/** Eraser tolerance, in pixels: maximum distance from the click to the stroke. */
export const ERASE_TOLERANCE_PX = 14;

/** Size, in world units, of one screen pixel at this depth (perspective camera). */
export function worldPerPixel(depth: number, fovDeg: number, viewportHeight: number): number {
  const half = Math.tan((Math.max(fovDeg, 1) * Math.PI) / 360);
  return (2 * half * Math.max(depth, 0)) / Math.max(viewportHeight, 1);
}

/** Euclidean distance between two points. */
export function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * True if the stroke must be cut between these two samples: the world displacement exceeds
 * `factor` times the one a screen step of this length produces at this depth.
 */
export function breaksRun(
  prev: SurfaceSample,
  next: SurfaceSample,
  view: { fovDeg: number; height: number },
  factor = HOLE_JUMP_FACTOR,
): boolean {
  const moved = distance3(prev.world, next.world);
  // The smaller of the two depths gives the shorter step, hence the strictest threshold:
  // a jump towards the background of the scene must not justify itself.
  const scale = worldPerPixel(Math.min(prev.depth, next.depth), view.fovDeg, view.height);
  const expected = Math.max(next.screenStep, 1) * scale;
  return moved > expected * factor;
}

/** Approximate normal of a stroke: normalized average of the point to camera directions. */
export function runNormal(samples: readonly SurfaceSample[]): Vec3 | null {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const s of samples) {
    x += s.toCamera[0];
    y += s.toCamera[1];
    z += s.toCamera[2];
  }
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length < 1e-9) return null;
  return [x / length, y / length, z / length];
}

/** Object coordinates of the samples, flattened for the stored stroke. */
export function flattenObject(samples: readonly SurfaceSample[]): number[] {
  const points: number[] = [];
  for (const s of samples) points.push(s.object[0], s.object[1], s.object[2]);
  return points;
}

/** Centre of a stroke (average of its points): origin of the orientation measurement. */
export function strokeCenter(points: readonly number[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  const n = Math.floor(points.length / 3);
  if (n === 0) return [0, 0, 0];
  for (let i = 0; i < n; i++) {
    x += points[3 * i];
    y += points[3 * i + 1];
    z += points[3 * i + 2];
  }
  return [x / n, y / n, z / n];
}

/** Distance from a point to the segment [a, b], in 2D. */
export function distanceToSegment(
  p: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Projection of an object point to view pixels, or `null` if it is behind the camera. */
export type Projector = (x: number, y: number, z: number) => [number, number] | null;

/**
 * Index of the stroke closest to the screen point, or `null` if none falls within the tolerance.
 * Strokes are compared segment by segment: a long stroke does not win just because it is long.
 */
export function pickStroke(
  strokes: readonly { points: number[] }[],
  at: readonly [number, number],
  project: Projector,
  tolerancePx = ERASE_TOLERANCE_PX,
): number | null {
  let bestIndex: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < strokes.length; index++) {
    const { points } = strokes[index];
    let previous: [number, number] | null = null;
    for (let i = 0; i + 2 < points.length; i += 3) {
      const screen = project(points[i], points[i + 1], points[i + 2]);
      if (screen) {
        const d = previous
          ? distanceToSegment(at, previous, screen)
          : Math.hypot(at[0] - screen[0], at[1] - screen[1]);
        if (d <= tolerancePx && d < bestDistance) {
          bestIndex = index;
          bestDistance = d;
        }
      }
      previous = screen;
    }
  }
  return bestIndex;
}
