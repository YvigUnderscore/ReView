// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';

/**
 * Pont vers l'analyseur USD (Phase 45, 45.B) — `workers/usd/analyze_usd.py`, execute par le
 * runtime OpenUSD officiel (`usd-core`). Deux responsabilites, volontairement separees :
 *
 *  - **parsing** (`parseUsdScan`, `parseUsdStageInfo`) : pur, valide par Zod, testable sans
 *    binaire. La sortie d'un script externe est une entree non fiable comme une autre.
 *  - **execution** : mince enveloppe `execFile` (jamais de shell) avec timeout obligatoire —
 *    une scene pathologique ne doit pas immobiliser un slot de worker.
 *
 * L'outillage est **optionnel** : sans lui, le worker retombe sur les heuristiques de
 * `usdArchive.ts` et se prive du rapport d'assets manquants, sans casser la conversion.
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

/** Prim du scenegraph (46.A) — l'arbre est transporte a plat, le front le renested. */
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
  // USD n'autorise que Y ou Z ; toute autre valeur est ramenee au defaut glTF (Y).
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
  /** Chemins des prims `Material` — masque d'import des variantes cuites (46.G). */
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

/** Selection de variantes demandee : `{ "/World/Asset": { "modelingVariant": "hero" } }`. */
export type UsdVariantSelection = Record<string, Record<string, string>>;

/**
 * Isole l'objet JSON produit par le script. OpenUSD ecrit ses avertissements sur stderr, mais un
 * plugin tiers peut polluer stdout : on retient la **derniere** ligne qui est un objet JSON.
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

/** Parse la sortie du mode `scan` (graphe de dependances entre couches). */
export function parseUsdScan(stdout: string): UsdLayerDep[] {
  const parsed = usdScanSchema.safeParse(JSON.parse(extractJsonLine(stdout)));
  if (!parsed.success) throw new Error('USD analysis: invalid layer graph');
  return parsed.data.layers;
}

/** Parse la sortie du mode `inspect` (description de la scene), avec deduplication. */
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
 * Ne conserve que les selections **connues** de la scene : un nom de variantSet ou une valeur
 * inventes ne doivent jamais atteindre le pipeline (l'entree vient d'une requete utilisateur).
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

/** Configuration d'execution injectee par l'appelant (valeurs issues de `config/env.ts`). */
export interface UsdToolConfig {
  /** Interpreteur Python disposant du module `pxr` (venv `usd-core`). */
  python: string;
  /** Chemin du script `analyze_usd.py`. */
  script: string;
  timeoutMs: number;
}

const run = (cfg: UsdToolConfig, args: string[]) =>
  execFileAsync(cfg.python, [cfg.script, ...args], {
    timeout: cfg.timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });

/** Vrai si l'analyseur est utilisable (module `pxr` importable) — jamais d'exception. */
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

/** Graphe de dependances des couches USD d'un dossier extrait. */
export async function scanUsdDirectory(directory: string, cfg: UsdToolConfig): Promise<UsdLayerDep[]> {
  const { stdout } = await run(cfg, ['scan', '--input', directory]);
  return parseUsdScan(stdout);
}

/**
 * Decrit une scene USD. `overlayOut` + `variantsFile` demandent l'ecriture d'une couche
 * d'overlay portant la selection de variantes : c'est `info.stagePath` qu'il faut alors
 * convertir, pas le fichier d'origine (qui n'est jamais modifie).
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

/** Une couche d'overlay a ecrire : selection de variantes posee au-dessus de la racine. */
export interface UsdOverlayRequest {
  out: string;
  variants: UsdVariantSelection;
}

/**
 * Ecrit un lot de couches d'overlay en **une** invocation (46.P) : la preparation des
 * variantes a cuire en demandait une par option, soit des centaines de compositions
 * completes sur une scene de production. Le script ecrit du Sdf pur, sans composer.
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
