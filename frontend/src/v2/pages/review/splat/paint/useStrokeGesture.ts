// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef } from 'react';
import type { Line2 } from 'three/addons/lines/Line2.js';
import type { SplatPaintStroke } from '../../reviewTypes';
import type { LineModules } from './lineModules';
import { buildStrokeLine, disposeStrokeLine } from './strokes';
import { raycastSurface, type PaintSceneHandle, type Viewport } from './surfaceRay';
import { breaksRun, flattenObject, runNormal, type SurfaceSample } from './surfaceTrace';

/**
 * Gesture of the 3D surface brush: from the screen sample to the stroke laid on the cloud.
 *
 * Two defects of the original painter disappear here. First, **the preview**: the stroke only
 * existed on release, the gesture showing only a 2D polyline pasted onto the screen, which did not
 * follow the relief, so the real stroke was discovered too late. Each sample is now raycast on the
 * fly and the 3D line is rebuilt along the way: what one sees during the gesture is exactly what
 * will be sent. Second, **the straight rope**: a gesture crossing a hole joined the two edges with
 * a floating segment. A gesture now produces *one or several* strokes, one per continuous portion
 * of surface (cf. `surfaceTrace.breaksRun`).
 */
export interface StrokeGesture {
  /** Start of the gesture (press). */
  begin: () => void;
  /** A screen sample. Returns true if the ray hit the surface. */
  sample: (point: [number, number], viewport: Viewport) => boolean;
  /** End of the gesture (release): the continuous portions become strokes. */
  end: () => void;
  /** Abandons the preview without laying anything (tool change, unmount). */
  cancel: () => void;
}

/** Continuous surface portion being traced. */
interface Run {
  samples: SurfaceSample[];
  line: Line2 | null;
}

export function useStrokeGesture({
  getSceneHandle,
  getLines,
  color,
  width,
  onStrokes,
}: {
  getSceneHandle: () => PaintSceneHandle | null;
  /** `Line2` classes, or `null` if the on-demand import has not arrived yet. */
  getLines: () => LineModules | null;
  color: string;
  width: number;
  onStrokes: (strokes: SplatPaintStroke[]) => void;
}): StrokeGesture {
  const runsRef = useRef<Run[]>([]);
  const lastScreenRef = useRef<[number, number] | null>(null);
  // Open portion: closed by a ray into the void or by a surface cut.
  const openRef = useRef(false);
  // Colour and thickness read at the time of the gesture, never those captured at mount.
  const styleRef = useRef({ color, width });
  useEffect(() => {
    styleRef.current = { color, width };
  }, [color, width]);

  const discard = useCallback(() => {
    for (const run of runsRef.current) if (run.line) disposeStrokeLine(run.line);
    runsRef.current = [];
    openRef.current = false;
    lastScreenRef.current = null;
  }, []);

  /** Rebuilds the preview line of the current portion (WYSIWYG: the final stroke, already). */
  const refresh = useCallback((handle: PaintSceneHandle, lines: LineModules, run: Run) => {
    if (run.samples.length < 2) return;
    if (run.line) disposeStrokeLine(run.line);
    const normal = runNormal(run.samples);
    run.line = buildStrokeLine(handle, lines, {
      type: 'splat-paint',
      points: flattenObject(run.samples),
      color: styleRef.current.color,
      width: styleRef.current.width,
      ...(normal ? { normal } : {}),
    });
    handle.mesh.add(run.line);
  }, []);

  const begin = useCallback(() => discard(), [discard]);

  const sample = useCallback(
    (point: [number, number], viewport: Viewport) => {
      const handle = getSceneHandle();
      if (!handle) return false;
      const previous = lastScreenRef.current;
      const step = previous ? Math.hypot(point[0] - previous[0], point[1] - previous[1]) : 0;
      lastScreenRef.current = point;
      const hit = raycastSurface(handle, point, viewport, step);
      if (!hit) {
        openRef.current = false; // ray into the void: the portion stops here
        return false;
      }
      const open = openRef.current ? runsRef.current[runsRef.current.length - 1] : undefined;
      const last = open?.samples[open.samples.length - 1];
      if (last && breaksRun(last, hit, { fovDeg: handle.camera.fov, height: viewport.height }))
        openRef.current = false;
      if (!openRef.current) {
        runsRef.current.push({ samples: [], line: null });
        openRef.current = true;
      }
      const run = runsRef.current[runsRef.current.length - 1];
      run.samples.push(hit);
      const lines = getLines();
      if (lines) refresh(handle, lines, run);
      return true;
    },
    [getSceneHandle, getLines, refresh],
  );

  const end = useCallback(() => {
    const strokes: SplatPaintStroke[] = [];
    for (const run of runsRef.current) {
      if (run.line) disposeStrokeLine(run.line);
      if (run.samples.length < 2) continue; // an isolated point is not a stroke
      const normal = runNormal(run.samples);
      strokes.push({
        type: 'splat-paint',
        points: flattenObject(run.samples),
        color: styleRef.current.color,
        width: styleRef.current.width,
        ...(normal ? { normal } : {}),
      });
    }
    runsRef.current = [];
    openRef.current = false;
    lastScreenRef.current = null;
    if (strokes.length > 0) onStrokes(strokes);
  }, [onStrokes]);

  // Unmount: the preview must not survive the scene that carries it.
  useEffect(() => discard, [discard]);

  return { begin, sample, end, cancel: discard };
}
