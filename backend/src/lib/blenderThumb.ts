// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';

/**
 * Drives headless Blender for the **thumbnail render** of a 3D model.
 *
 * Same split of roles as `lib/blenderUsd`: here the pure, testable part (command line, reading the
 * summary); execution lives in `services/ModelConvertService`.
 *
 * The engine is **Cycles on CPU**, never EEVEE: since Blender 4.2, EEVEE Next requires a GPU
 * exposing OpenGL 4.3, which the worker's Docker image does not have. An EEVEE render would fail
 * there or, worse, output a black image. Cycles CPU is slow but always gives the same image,
 * everywhere, and 512 px at a few dozen samples renders in seconds.
 */

/** Summary marker: must stay identical to `MARKER` in `workers/usd/render_thumb.py`. */
export const BLENDER_THUMB_MARKER = 'REVIEW_THUMB_JSON';

/** Side length of the rendered thumbnail. */
export const BLENDER_THUMB_SIZE = 512;

/** Cycles samples: beyond this, the denoiser gains nothing on a thumbnail. */
export const BLENDER_THUMB_SAMPLES = 24;

/**
 * Maximum render delay: same pattern as `lib/ffmpegTimeout`. A process that stops progressing
 * blocks the queue slot, and nothing signals it. Ten minutes comfortably covers 512 px at 24 samples
 * on CPU, even for a heavy scene.
 */
export const BLENDER_THUMB_TIMEOUT_MS = 10 * 60_000;

/** Non-render reason to log when the timeout is exceeded (the process is killed). */
export const blenderThumbTimeoutReason = (timeoutMs: number): string =>
  `timeout:${Math.round(timeoutMs / 1000)}s`;

export const blenderThumbSummarySchema = z.object({
  rendered: z.boolean().default(false),
  /** Non-render reason (`no-geometry`, `import-failed`...), for the worker log. */
  reason: z.string().default(''),
  objects: z.number().int().nonnegative().default(0),
  blender: z.string().default(''),
});

export type BlenderThumbSummary = z.infer<typeof blenderThumbSummarySchema>;

export interface BlenderThumbOptions {
  /** GLB to render (the conversion output, or the original file if already a GLB). */
  input: string;
  /** PNG produced (transparent background). */
  output: string;
  size?: number;
  samples?: number;
}

/**
 * Full `blender` arguments. `--python-exit-code 1` is essential: without it a script exception exits
 * with code 0 and the failure would pass for a success without an image.
 */
export function buildThumbArgs(scriptPath: string, opts: BlenderThumbOptions): string[] {
  return [
    '-b',
    '--factory-startup',
    '--python-exit-code',
    '1',
    '--python',
    scriptPath,
    '--',
    '--input',
    opts.input,
    '--output',
    opts.output,
    '--size',
    String(Math.max(32, Math.round(opts.size ?? BLENDER_THUMB_SIZE))),
    '--samples',
    String(Math.max(1, Math.round(opts.samples ?? BLENDER_THUMB_SAMPLES))),
  ];
}

/**
 * Extracts the summary from Blender's output stream (very chatty). Returns `null` if the marker is
 * absent: we do not guess, the caller falls back on the existence of the produced file.
 */
export function parseThumbSummary(stdout: string): BlenderThumbSummary | null {
  const line = stdout
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.trimStart().startsWith(BLENDER_THUMB_MARKER));
  if (!line) return null;
  const json = line.slice(line.indexOf(BLENDER_THUMB_MARKER) + BLENDER_THUMB_MARKER.length).trim();
  try {
    const parsed = blenderThumbSummarySchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
