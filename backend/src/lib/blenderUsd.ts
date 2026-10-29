// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';

/**
 * Drives headless Blender for the USD to GLB conversion (Phase 45, 45.C).
 *
 * Pure, testable part: building the command line and reading the summary printed by
 * `workers/usd/usd_to_glb.py`. The execution itself lives in `services/ModelConvertService.ts`
 * (execFile + timeout).
 *
 * Blender writes a lot of noise on stdout (plugin loading, export statistics): the summary is
 * prefixed with a **marker** rather than guessed, otherwise any JSON line from a third-party plugin
 * would corrupt the metadata shown in the technical sheet.
 */

/** Marker of the summary line: must stay identical to `MARKER` in `usd_to_glb.py`. */
export const BLENDER_SUMMARY_MARKER = 'REVIEW_USD_JSON';

/** USD purposes exposable in review (`guide` exists but has no visual interest). */
export const USD_PURPOSES = ['render', 'proxy', 'guide'] as const;
export type UsdPurpose = (typeof USD_PURPOSES)[number];

/** True if the value is a known USD purpose (API input guard). */
export function isUsdPurpose(value: unknown): value is UsdPurpose {
  return typeof value === 'string' && (USD_PURPOSES as readonly string[]).includes(value);
}

export const blenderSummarySchema = z.object({
  objects: z.number().int().nonnegative().default(0),
  meshes: z.number().int().nonnegative().default(0),
  armatures: z.number().int().nonnegative().default(0),
  cameras: z.number().int().nonnegative().default(0),
  materials: z.number().int().nonnegative().default(0),
  images: z.number().int().nonnegative().default(0),
  frameStart: z.number().default(0),
  frameEnd: z.number().default(0),
  fps: z.number().positive().default(24),
  animated: z.boolean().default(false),
  blender: z.string().default(''),
  /** Variant options actually baked into the GLB (46.G). */
  variantsBaked: z
    .array(
      z.object({
        prim: z.string(),
        set: z.string(),
        option: z.string(),
        objects: z.number().int().nonnegative().default(0),
      }),
    )
    .default([]),
  /** Options dropped for lack of budget: switching then remains a reconversion. */
  variantsSkipped: z.array(z.object({ prim: z.string(), set: z.string(), option: z.string() })).default([]),
});

export type BlenderSummary = z.infer<typeof blenderSummarySchema>;

/** Conversion options passed to the Blender script. */
export interface BlenderUsdOptions {
  input: string;
  output: string;
  purpose?: UsdPurpose;
  /** TimeCode range from the analyser: without it, the export falls back to 1-250. */
  frameStart?: number;
  frameEnd?: number;
  fps?: number;
  /** Forces a static output (scene without animation, or animation not wanted). */
  noAnimation?: boolean;
  /** JSON manifest of the variant options to bake into the GLB (46.G). */
  variantLayers?: string;
  /** Vertex budget beyond which remaining options are no longer baked. */
  variantVertexBudget?: number;
  /** Baking time budget (seconds): the conversion must never time out (46.P). */
  variantTimeBudget?: number;
}

/** A variant option to bake: the layer to import and the subtree to keep from it. */
export interface VariantLayerEntry {
  /** USD layer (overlay) selecting this option. */
  stage: string;
  /** Carrying prim of the variant set: only its subtree is kept. */
  prim: string;
  set: string;
  option: string;
  /** Option active in the base scene, used to label the original subtree. */
  default: string;
  /** Paths to populate at import (carrying prim + materials stored elsewhere), see `buildVariantMask`. */
  mask?: string;
}

/**
 * Import mask of a variant option: the carrying prim **and** the materials stored outside its subtree.
 *
 * Blender applies `prim_path_mask` as a USD population mask: anything outside the mask no longer
 * exists on the stage, including the target of a `material:binding`. A library material
 * (`/World/mtl/...` next to the asset) then becomes unfindable and the baked object comes out
 * without material, i.e. mirror white metal in the viewer, since the glTF spec imposes the default
 * material. Paths outside the subtree are therefore added to the mask; those it already contains are
 * useless, and Blender ignores a path absent from the stage.
 */
export function buildVariantMask(prim: string, materialPaths: readonly string[] = []): string {
  const outside = materialPaths.filter(
    (path) =>
      path.startsWith('/') &&
      // The mask is a list delimited by `,`/`;`: a path containing one would break it.
      !/[,;]/.test(path) &&
      path !== prim &&
      !path.startsWith(`${prim}/`),
  );
  return [prim, ...new Set(outside)].join(',');
}

/**
 * Full `blender` arguments: `-b` (headless, already disables the audio device), `--factory-startup`
 * (no add-on or user preference loaded) and `--python-exit-code` (without it a script exception
 * exits with code 0 and the failure would go unnoticed). Script arguments come after the `--` separator.
 */
export function buildBlenderArgs(scriptPath: string, opts: BlenderUsdOptions): string[] {
  const args = [
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
    '--purpose',
    opts.purpose ?? 'render',
  ];
  const hasRange =
    Number.isFinite(opts.frameStart) &&
    Number.isFinite(opts.frameEnd) &&
    (opts.frameEnd as number) >= (opts.frameStart as number);
  if (hasRange) args.push('--frame-start', String(opts.frameStart), '--frame-end', String(opts.frameEnd));
  if (Number.isFinite(opts.fps) && (opts.fps as number) > 0) args.push('--fps', String(opts.fps));
  if (opts.noAnimation) args.push('--no-animation');
  if (opts.variantLayers) args.push('--variant-layers', opts.variantLayers);
  if (Number.isFinite(opts.variantVertexBudget) && (opts.variantVertexBudget as number) > 0)
    args.push('--variant-vertex-budget', String(opts.variantVertexBudget));
  if (Number.isFinite(opts.variantTimeBudget) && (opts.variantTimeBudget as number) > 0)
    args.push('--variant-time-budget', String(opts.variantTimeBudget));
  return args;
}

/**
 * Extracts the conversion summary from Blender's output stream. Returns `null` if the marker is
 * absent: the conversion may have succeeded (the GLB is checked separately) without a usable
 * summary, in which case the technical sheet goes without it.
 */
export function parseBlenderSummary(stdout: string): BlenderSummary | null {
  const line = stdout
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.trimStart().startsWith(BLENDER_SUMMARY_MARKER));
  if (!line) return null;
  const json = line.slice(line.indexOf(BLENDER_SUMMARY_MARKER) + BLENDER_SUMMARY_MARKER.length).trim();
  try {
    const parsed = blenderSummarySchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Short, readable error message from Blender's stderr: only the last significant lines are kept
 * (Blender prefixes its warnings with `Warning:`/`Info:`).
 */
export function summarizeBlenderError(stderr: string, fallback = 'erreur inconnue'): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(Info|Warning|Read prefs|found bundled python)/i.test(l));
  return lines.slice(-3).join(' — ').slice(0, 500) || fallback;
}
