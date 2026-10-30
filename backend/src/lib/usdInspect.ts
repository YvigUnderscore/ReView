// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';

/**
 * Bridge to the USD analyzer (Phase 45, 45.B): `workers/usd/analyze_usd.py`, executed by the
 * official OpenUSD runtime (`usd-core`). Two responsibilities, deliberately separated:
 *
 *  - **parsing** (`parseUsdScan`, `parseUsdStageInfo`): pure, validated by Zod, testable without
 *    the binary. The output of an external script is untrusted input like any other.
 *  - **execution**: thin `execFile` wrapper (never a shell) with a mandatory timeout: a
 *    pathological scene must not tie up a worker slot.
 *
 * The tooling is **optional**: without it, the worker falls back to the heuristics of
 * `usdArchive.ts` and forgoes the missing-assets report, without breaking the conversion.
 */

const execFileAsync = promisify(execFile);

const layerDepSchema = z.object({
  layer: z.string(),
  deps: z.array(z.string()).default([]),
});

export const usdScanSchema = z.object({ layers: z.array(layerDepSchema).default([]) });

const variantSetSchema = z.object({
  prim: z.string(),
  name: z.string(),
  options: z.array(z.string()).default([]),
  selected: z.string().default(''),
});

/** Prim of the scene graph (46.A): the tree is transported flat, and the front end nests it again. */
const primSchema = z.object({
  path: z.string(),
  name: z.string().default(''),
  type: z.string().default(''),
  kind: z.string().default(''),
  purpose: z.string().default(''),
  variantSets: z.array(z.string()).default([]),
  active: z.boolean().default(true),
  instanceable: z.boolean().default(false),
});

export const usdStageInfoSchema = z.object({
  root: z.string(),
  stagePath: z.string(),
  defaultPrim: z.string().nullable().default(null),
  // USD only allows Y or Z; any other value is brought back to the glTF default (Y).
  upAxis: z.string().transform((v) => (v.toUpperCase() === 'Z' ? 'Z' : 'Y')),
  metersPerUnit: z.number().positive().default(1),
  startTimeCode: z.number().default(0),
  endTimeCode: z.number().default(0),
  timeCodesPerSecond: z.number().positive().default(24),
  hasAnimation: z.boolean().default(false),
  hasSkeleton: z.boolean().default(false),
  variantSets: z.array(variantSetSchema).default([]),
  appliedVariants: z.array(z.object({ prim: z.string(), name: z.string(), value: z.string() })).default([]),
  purposes: z.array(z.string()).default([]),
  /** Paths of the `Material` prims: import mask of the baked variants (46.G). */
  materialPaths: z.array(z.string()).default([]),
  missingAssets: z.array(z.string()).default([]),
  missingAssetsTotal: z.number().int().nonnegative().default(0),
  layerCount: z.number().int().nonnegative().default(0),
  primCount: z.number().int().nonnegative().default(0),
  prims: z.array(primSchema).default([]),
  primsTruncated: z.boolean().default(false),
});

export type UsdLayerDep = z.infer<typeof layerDepSchema>;
export type UsdVariantSet = z.infer<typeof variantSetSchema>;
export type UsdPrim = z.infer<typeof primSchema>;
export type UsdStageInfo = z.infer<typeof usdStageInfoSchema>;

/** Requested variant selection: `{ "/World/Asset": { "modelingVariant": "hero" } }`. */
export type UsdVariantSelection = Record<string, Record<string, string>>;

/**
 * Isolates the JSON object produced by the script. OpenUSD writes its warnings to stderr, but a
 * third-party plugin may pollute stdout: we keep the **last** line that is a JSON object.
 */
export function extractJsonLine(stdout: string): string {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{') && l.endsWith('}'));
  const last = lines.at(-1);
  if (!last) throw new Error('USD analysis: no usable JSON output');
  return last;
}

/** Parses the output of the `scan` mode (dependency graph between layers). */
export function parseUsdScan(stdout: string): UsdLayerDep[] {
  const parsed = usdScanSchema.safeParse(JSON.parse(extractJsonLine(stdout)));
  if (!parsed.success) throw new Error('USD analysis: invalid layer graph');
  return parsed.data.layers;
}

/** Parses the output of the `inspect` mode (scene description), with deduplication. */
export function parseUsdStageInfo(stdout: string): UsdStageInfo {
  const parsed = usdStageInfoSchema.safeParse(JSON.parse(extractJsonLine(stdout)));
  if (!parsed.success) throw new Error('USD analysis: invalid scene description');
  const info = parsed.data;
  const seen = new Set<string>();
  return {
    ...info,
    variantSets: info.variantSets.filter((v) => {
      const key = `${v.prim}\u0000${v.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    missingAssets: [...new Set(info.missingAssets)],
  };
}

/**
 * Keeps only the **known** selections of the scene: an invented variantSet name or value must
 * never reach the pipeline (the input comes from a user request).
 */
export function sanitizeVariantSelection(
  requested: UsdVariantSelection,
  known: UsdVariantSet[],
): UsdVariantSelection {
  const clean: UsdVariantSelection = {};
  for (const set of known) {
    const value = requested[set.prim]?.[set.name];
    if (value && set.options.includes(value)) {
      clean[set.prim] = { ...(clean[set.prim] ?? {}), [set.name]: value };
    }
  }
  return clean;
}

/** Execution configuration injected by the caller (values taken from `config/env.ts`). */
export interface UsdToolConfig {
  /** Python interpreter with the `pxr` module (`usd-core` venv). */
  python: string;
  /** Path of the `analyze_usd.py` script. */
  script: string;
  timeoutMs: number;
}

const run = (cfg: UsdToolConfig, args: string[]) =>
  execFileAsync(cfg.python, [cfg.script, ...args], {
    timeout: cfg.timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });

/** True if the analyzer is usable (importable `pxr` module): never throws. */
export async function isUsdToolingAvailable(cfg: UsdToolConfig): Promise<boolean> {
  try {
    await execFileAsync(cfg.python, ['-c', 'import pxr'], {
      timeout: Math.min(cfg.timeoutMs, 30_000),
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

/** Dependency graph of the USD layers of an extracted directory. */
export async function scanUsdDirectory(directory: string, cfg: UsdToolConfig): Promise<UsdLayerDep[]> {
  const { stdout } = await run(cfg, ['scan', '--input', directory]);
  return parseUsdScan(stdout);
}

/**
 * Describes a USD scene. `overlayOut` + `variantsFile` request the writing of an overlay layer
 * carrying the variant selection: it is then `info.stagePath` that must be converted, not the
 * original file (which is never modified).
 */
export async function inspectUsdStage(
  input: string,
  cfg: UsdToolConfig,
  opts: { variantsFile?: string; overlayOut?: string } = {},
): Promise<UsdStageInfo> {
  const args = ['inspect', '--input', input];
  if (opts.variantsFile && opts.overlayOut)
    args.push('--variants-file', opts.variantsFile, '--overlay-out', opts.overlayOut);
  const { stdout } = await run(cfg, args);
  return parseUsdStageInfo(stdout);
}

/** An overlay layer to write: variant selection set above the root layer. */
export interface UsdOverlayRequest {
  out: string;
  variants: UsdVariantSelection;
}

/**
 * Writes a batch of overlay layers in **one** invocation (46.P): preparing the variants to bake
 * used to request one per option, i.e. hundreds of complete compositions on a production scene.
 * The script writes pure Sdf, without composing.
 */
export async function writeVariantOverlays(
  root: string,
  overlays: UsdOverlayRequest[],
  cfg: UsdToolConfig,
  manifestPath: string,
): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(manifestPath, JSON.stringify(overlays), 'utf8');
  const { stdout } = await run(cfg, ['overlays', '--input', root, '--manifest', manifestPath]);
  const parsed = z
    .object({ written: z.number().int().nonnegative() })
    .safeParse(JSON.parse(extractJsonLine(stdout)));
  if (!parsed.success || parsed.data.written !== overlays.length)
    throw new Error('USD analysis: variant layers were not written');
}
