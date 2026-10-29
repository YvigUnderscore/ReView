// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, dirname, extname, join, relative } from 'node:path';
import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

import { env } from '../config/env';
import { logger } from '../lib/logger';
import { isUsdModel, pickModelFile, type ModelConverter } from '../lib/modelConvert';
import { pickUsdRootLayer } from '../lib/usdArchive';
import { describeRejection, planExtraction, resolveInside, type ZipEntryInfo } from '../lib/zipSafety';
import {
  inspectUsdStage,
  isUsdToolingAvailable,
  sanitizeVariantSelection,
  scanUsdDirectory,
  writeVariantOverlays,
  type UsdOverlayRequest,
  type UsdStageInfo,
  type UsdToolConfig,
  type UsdVariantSelection,
  type UsdPrim,
  type UsdVariantSet,
} from '../lib/usdInspect';
import {
  buildBlenderArgs,
  buildVariantMask,
  parseBlenderSummary,
  summarizeBlenderError,
  type BlenderSummary,
  type UsdPurpose,
  type VariantLayerEntry,
} from '../lib/blenderUsd';
import {
  BLENDER_THUMB_TIMEOUT_MS,
  blenderThumbTimeoutReason,
  buildThumbArgs,
  parseThumbSummary,
} from '../lib/blenderThumb';
import { ignoreFailure } from '../lib/ignoreFailure';

/**
 * Conversion of 3D media to GLB — the only format read by the review's Three.js viewer.
 * Extracted from `workers/ffmpeg.worker.ts` in Phase 45 (45.C): the business logic belongs to the services,
 * and the worker had long outgrown a readable size.
 *
 * Routing: `.glb` copied as is, `.gltf` packed into JS, USD via Blender (full OpenUSD), everything else via
 * assimp. Archives (`.zip`) are extracted under strict control (`lib/zipSafety`)
 * then re-routed to their main file; a `.usdz` is opened directly by the USD tools, without extraction on our
 * side.
 *
 * The source file is never modified: everything is produced in the job's temporary directory.
 */

const execFileAsync = promisify(execFile);

/** A truly empty file fits in one empty DEFLATE block; beyond that, the declaration lies. */
const EMPTY_ENTRY_MAX_COMPRESSED = 16;

/** Accepted zip compression methods: 0 = stored, 8 = DEFLATE. Anything else is refused. */
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/**
 * Reads an entry while **bounding the output to the declared size**, never allocating more.
 *
 * This is the key point of the zip-bomb protection: the catalogue's declaration is not a pass, it is a
 * ceiling. An entry announcing 16 bytes that inflates to gigabytes makes `inflateRawSync` fail
 * on `maxOutputLength` — the worker's memory is never committed beyond what the cumulative budget has already
 * allowed.
 *
 * Estimating the worst case as `compressedSize × 1032` (DEFLATE's physical expansion rate) would be simpler
 * but rejects any legitimately poorly compressible file: a 16 MB PNG stored
 * as is would "weigh" 16 GB and condemn the entire archive.
 */
function readEntryBounded(entry: {
  entryName: string;
  header: { size: number; method: number };
  getCompressedData: () => Buffer;
}): Buffer {
  const declared = Math.max(0, entry.header.size);
  const raw = entry.getCompressedData();

  if (entry.header.method === METHOD_STORED) {
    if (raw.length !== declared)
      throw new Error(
        `Archive refusée : l'entrée « ${entry.entryName} » annonce ${declared} octets et en contient ${raw.length}`,
      );
    return raw;
  }
  if (entry.header.method !== METHOD_DEFLATE)
    throw new Error(
      `Archive refusée : l'entrée « ${entry.entryName} » utilise une compression non supportée (${entry.header.method})`,
    );
  if (declared === 0) {
    // `maxOutputLength: 0` is not a usable bound; we bound to one byte and refuse any non-empty output
    // through the comparison made by the caller.
    return inflateRawSync(raw, { maxOutputLength: 1 });
  }
  return inflateRawSync(raw, { maxOutputLength: declared });
}

/** Common execution options: mandatory timeout, bounded output, no Windows window. */
const runOpts = () => ({
  timeout: env.MODEL_CONVERT_TIMEOUT_MS,
  maxBuffer: 32 * 1024 * 1024,
  windowsHide: true as const,
});

/** Recomposition requested by the user (Phase 45, 45.E) — variants + USD purpose. */
export interface UsdRequest {
  variants: UsdVariantSelection;
  purpose: UsdPurpose;
}

/** `metadata.model.usd` block exposed as a technical sheet and consumed by the recomposition route. */
export interface UsdModelInfo {
  rootLayer: string;
  defaultPrim: string | null;
  upAxis: 'Y' | 'Z';
  metersPerUnit: number;
  frameRange: [number, number] | null;
  fps: number | null;
  hasAnimation: boolean;
  hasSkeleton: boolean;
  variantSets: UsdVariantSet[];
  purposes: string[];
  /** What was requested... */
  selection: UsdRequest;
  /** ...and whether the chosen converter was able to apply it (only Blender can). */
  selectionApplied: boolean;
  missingAssets: string[];
  missingAssetsTotal: number;
  layerCount: number;
  primCount: number;
  /** Scenegraph (46.A): flat list of prims, including the unrendered ones. */
  prims: UsdPrim[];
  primsTruncated: boolean;
}

export interface ConvertResult {
  converter: ModelConverter;
  usd?: UsdModelInfo;
  blender?: BlenderSummary;
}

export const DEFAULT_USD_REQUEST: UsdRequest = { variants: {}, purpose: 'render' };

// ---------------------------------------------------------------------------- USD tooling

/**
 * Locates a Python script of the worker. The `.py` files do not go through `tsc`: they stay in
 * `src/workers/usd/` (present in the image, `COPY . .`) whereas the executed code lives in `dist/`.
 */
function resolveUsdScript(name: string): string {
  // Reference path in the image: the worker runs from `dist/`, the scripts live in `src/` (copied as is by
  // the Dockerfile).
  const packaged = join(__dirname, '..', '..', 'src', 'workers', 'usd', name);
  const candidates = [
    join(__dirname, '..', 'workers', 'usd', name), // dist/workers/usd (if ever copied)
    packaged,
    join(process.cwd(), 'src', 'workers', 'usd', name), // dev (tsx, cwd=backend)
  ];
  return candidates.find((p) => existsSync(p)) ?? packaged;
}

const usdToolConfig = (): UsdToolConfig => ({
  python: env.USD_PYTHON_BIN,
  script: resolveUsdScript('analyze_usd.py'),
  timeoutMs: env.MODEL_CONVERT_TIMEOUT_MS,
});

/** Cached tooling probes: no need to relaunch a binary for every job. */
let blenderProbe: Promise<boolean> | null = null;
let usdToolsProbe: Promise<boolean> | null = null;

export function resetToolProbes(): void {
  blenderProbe = null;
  usdToolsProbe = null;
}

function hasBlender(): Promise<boolean> {
  blenderProbe ??= execFileAsync(env.USD_BLENDER_BIN, ['--version'], {
    timeout: 60_000,
    windowsHide: true,
  })
    .then(() => true)
    .catch(() => false);
  return blenderProbe;
}

function hasUsdTools(): Promise<boolean> {
  usdToolsProbe ??= isUsdToolingAvailable(usdToolConfig());
  return usdToolsProbe;
}

/** Binary of the fallback native USD converter (`guc`), or undefined. */
const usdConverterBin = (): string | undefined => env.USD_GLTF_CONVERTER?.trim() || undefined;

/** Usable error message from an `execFile` failure (timeout included). */
function describeExecError(err: unknown, who: string): string {
  const e = err as { killed?: boolean; stderr?: string; stdout?: string; message?: string };
  if (e.killed) return `${who} : délai dépassé (${Math.round(env.MODEL_CONVERT_TIMEOUT_MS / 1000)} s)`;
  const detail = (e.stderr || e.stdout || e.message || '').toString().trim();
  return `${who} : ${summarizeBlenderError(detail) || 'erreur inconnue'}`;
}

// ---------------------------------------------------------------------------- converters

/** Checks that the GLB was indeed produced and is not empty. */
async function assertGlbProduced(output: string, who: string): Promise<void> {
  const info = await stat(output).catch(() => null);
  if (!info || info.size === 0) throw new Error(`${who} conversion: the output GLB is empty or missing`);
}

/** Converts a .gltf (text, buffers and relative textures) into a binary .glb via gltf-import-export. */
async function convertGltfToGlb(input: string, output: string): Promise<void> {
  const { ConvertGltfToGLB } = await import('gltf-import-export');
  try {
    ConvertGltfToGLB(input, output);
  } catch (err) {
    const e = err as { message?: string };
    throw new Error(`glTF to GLB conversion failed : ${(e.message || 'erreur inconnue').slice(0, 500)}`, {
      cause: err,
    });
  }
  await assertGlbProduced(output, 'glTF→GLB');
}

/** Converts a 3D model (FBX/OBJ/DAE/STL…) into GLB via assimp. */
async function convertWithAssimp(input: string, output: string): Promise<void> {
  try {
    await execFileAsync('assimp', ['export', input, output, '-f', 'glb2'], runOpts());
  } catch (err) {
    throw new Error(describeExecError(err, 'assimp conversion failed'), { cause: err });
  }
  await assertGlbProduced(output, 'assimp');
}

/**
 * Prepares an overlay layer per **unselected variant option** (46.G): each option is then imported by Blender
 * and baked into the GLB, which makes the switch instantaneous in review — and therefore possible after
 * publication, without reconversion.
 *
 * The cost is additive: each option is composed with the other variant sets at their current value; we do not
 * produce the Cartesian product of combinations.
 */
async function prepareVariantLayers(
  source: string,
  info: UsdStageInfo | null,
  workDir: string,
): Promise<VariantLayerEntry[]> {
  if (!info || info.variantSets.length === 0) return [];
  const entries: VariantLayerEntry[] = [];
  const overlays: UsdOverlayRequest[] = [];
  let index = 0;

  for (const set of info.variantSets) {
    const current = set.selected || set.options[0];
    for (const option of set.options) {
      if (option === current) continue; // already present in the base scene
      if (entries.length >= env.USD_MAX_BAKED_VARIANTS) break;
      index += 1;
      const overlayOut = join(dirname(source), `_review_variant_${index}.usda`);
      overlays.push({ out: overlayOut, variants: { [set.prim]: { [set.name]: option } } });
      entries.push({
        stage: overlayOut,
        prim: set.prim,
        set: set.name,
        option,
        default: current ?? '',
        // Without the materials stored outside the subtree, the baked option comes out unbound.
        mask: buildVariantMask(set.prim, info.materialPaths),
      });
    }
  }
  if (entries.length === 0) return [];

  // A single invocation for all layers (46.P): the former preparation composed the scene once per option —
  // prohibitive as soon as there are dozens of variant sets.
  try {
    await writeVariantOverlays(source, overlays, usdToolConfig(), join(workDir, 'variant-overlays.json'));
  } catch (err) {
    logger.warn({ err }, '[ModelConvert] couches de variantes non écrites — cuisson sautée');
    return [];
  }
  return entries;
}

/** Converts a USD scene via headless Blender (full OpenUSD: composition, materials, animation). */
async function convertWithBlender(
  stagePath: string,
  output: string,
  info: UsdStageInfo | null,
  purpose: UsdPurpose,
  variantLayers: VariantLayerEntry[],
  workDir: string,
): Promise<BlenderSummary | null> {
  let manifest: string | undefined;
  if (variantLayers.length > 0) {
    manifest = join(workDir, 'variant-layers.json');
    await writeFile(manifest, JSON.stringify(variantLayers), 'utf8');
  }
  const args = buildBlenderArgs(resolveUsdScript('usd_to_glb.py'), {
    input: stagePath,
    output,
    purpose,
    frameStart: info?.hasAnimation ? info.startTimeCode : undefined,
    frameEnd: info?.hasAnimation ? info.endTimeCode : undefined,
    fps: info?.timeCodesPerSecond,
    noAnimation: info ? !info.hasAnimation : false,
    variantLayers: manifest,
    variantVertexBudget: env.USD_VARIANT_VERTEX_BUDGET,
    // Baking must never let the conversion expire: it cuts itself at half the timeout and leaves the
    // remaining options in `variantsSkipped` (46.P).
    variantTimeBudget: Math.floor(env.MODEL_CONVERT_TIMEOUT_MS / 2000),
  });
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(env.USD_BLENDER_BIN, args, runOpts()));
  } catch (err) {
    throw new Error(describeExecError(err, 'USD conversion (Blender) failed'), { cause: err });
  }
  await assertGlbProduced(output, 'Blender');
  return parseBlenderSummary(stdout);
}

/**
 * Builds the USD metadata block exposed in review. `rootLayer` is **imposed** by the caller: the worker works
 * on a copy named `src.usdz`, a technical name that would make no sense in a technical sheet. For an archive,
 * the caller passes the path inside the archive.
 */
function buildUsdInfo(
  info: UsdStageInfo | null,
  rootLayer: string,
  request: UsdRequest,
  applied: boolean,
): UsdModelInfo {
  return {
    rootLayer,
    defaultPrim: info?.defaultPrim ?? null,
    upAxis: info?.upAxis ?? 'Y',
    metersPerUnit: info?.metersPerUnit ?? 1,
    frameRange: info?.hasAnimation ? [info.startTimeCode, info.endTimeCode] : null,
    fps: info?.timeCodesPerSecond ?? null,
    hasAnimation: info?.hasAnimation ?? false,
    hasSkeleton: info?.hasSkeleton ?? false,
    variantSets: info?.variantSets ?? [],
    purposes: info?.purposes ?? [],
    selection: request,
    selectionApplied: applied,
    missingAssets: info?.missingAssets ?? [],
    missingAssetsTotal: info?.missingAssetsTotal ?? 0,
    layerCount: info?.layerCount ?? 0,
    primCount: info?.primCount ?? 0,
    prims: info?.prims ?? [],
    primsTruncated: info?.primsTruncated ?? false,
  };
}

/**
 * Analyses a USD scene then converts it. The analysis is *best effort*: without `pxr` tooling,
 * we still convert (without USD technical sheet or missing-assets report).
 */
async function convertUsd(
  input: string,
  output: string,
  request: UsdRequest,
  workDir: string,
  /** Display name of the root layer: the media's original name, or the path inside the archive. */
  rootLabel: string,
): Promise<ConvertResult> {
  let info: UsdStageInfo | null = null;
  let stagePath = input;
  let applied = false;

  if (await hasUsdTools()) {
    info = await inspectUsdStage(input, usdToolConfig()).catch((err) => {
      logger.warn({ err }, '[ModelConvert] analyse USD indisponible, conversion sans fiche technique');
      return null;
    });

    // Recomposition: we never write into the original file — the variant selection goes through an overlay
    // layer that sub-layers the root (USD style).
    const selection = sanitizeVariantSelection(request.variants, info?.variantSets ?? []);
    if (info && Object.keys(selection).length > 0) {
      const variantsFile = join(workDir, 'variants.json');
      const overlayOut = join(dirname(input), '_review_overlay.usda');
      await writeFile(variantsFile, JSON.stringify(selection), 'utf8');
      const recomposed = await inspectUsdStage(input, usdToolConfig(), { variantsFile, overlayOut }).catch(
        (err) => {
          logger.warn({ err }, '[ModelConvert] overlay de variantes non appliqué');
          return null;
        },
      );
      if (recomposed) {
        info = recomposed;
        stagePath = recomposed.stagePath;
        applied = recomposed.appliedVariants.length > 0;
      }
    }
  }

  const rootLayer = rootLabel;
  if (await hasBlender()) {
    // Variant baking (46.G): each option becomes a subtree of the GLB; the switch is then made client-side —
    // instantaneous and available after publication.
    const variantLayers = await prepareVariantLayers(stagePath, info, workDir);
    const blender = await convertWithBlender(
      stagePath,
      output,
      info,
      request.purpose,
      variantLayers,
      workDir,
    );
    return {
      converter: 'blender',
      usd: buildUsdInfo(info, rootLayer, request, applied),
      ...(blender ? { blender } : {}),
    };
  }

  // Fallbacks: `guc` (faithful materials, static geometry) then assimp. Neither applies variants or purpose —
  // `selectionApplied` stays false.
  const bin = usdConverterBin();
  if (bin) {
    try {
      await execFileAsync(bin, [stagePath, output], runOpts());
      await assertGlbProduced(output, `USD natif (${bin})`);
      return { converter: 'usd', usd: buildUsdInfo(info, rootLayer, request, false) };
    } catch (err) {
      logger.warn(`[ModelConvert] convertisseur USD natif (${bin}) échoué, repli assimp: ${String(err)}`);
    }
  }
  await convertWithAssimp(stagePath, output);
  return { converter: 'assimp', usd: buildUsdInfo(info, rootLayer, request, false) };
}

// ---------------------------------------------------------------------------- thumbnail

/** Outcome of a thumbnail render: never an exception — a missing thumbnail is not a failure. */
export interface ModelThumbResult {
  rendered: boolean;
  /** Usable reason for the log when nothing was rendered (`blender-missing`, `no-geometry`…). */
  reason: string;
}

/**
 * Renders a PNG thumbnail (transparent background) of a GLB via headless Blender.
 *
 * **Never throws** and touches nothing but the output file: the thumbnail job is decorative, it must neither
 * block publication nor make a media fail. Blender absent from the image (build without
 * `INSTALL_USD_TOOLS`) is a nominal case: we return `blender-missing`, the caller logs it, and the
 * client-side capture at first display (`setAutoThumbnail`) remains the safety net.
 */
export async function renderModelThumbnail(
  glbPath: string,
  output: string,
  opts: { size?: number; samples?: number } = {},
): Promise<ModelThumbResult> {
  if (!(await hasBlender())) return { rendered: false, reason: 'blender-missing' };

  const timeout = Math.min(env.MODEL_CONVERT_TIMEOUT_MS, BLENDER_THUMB_TIMEOUT_MS);
  const args = buildThumbArgs(resolveUsdScript('render_thumb.py'), { input: glbPath, output, ...opts });
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(env.USD_BLENDER_BIN, args, {
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    }));
  } catch (err) {
    const e = err as { killed?: boolean; stderr?: string; stdout?: string; message?: string };
    if (e.killed) return { rendered: false, reason: blenderThumbTimeoutReason(timeout) };
    const detail = (e.stderr || e.stdout || e.message || '').toString();
    return { rendered: false, reason: summarizeBlenderError(detail, 'blender-failed') };
  }

  const summary = parseThumbSummary(stdout);
  if (summary && !summary.rendered) return { rendered: false, reason: summary.reason || 'not-rendered' };
  const info = await stat(output).catch(() => null);
  if (!info || info.size === 0) return { rendered: false, reason: 'empty-output' };
  return { rendered: true, reason: '' };
}

// ---------------------------------------------------------------------------- archives

/** Recursively walks a folder and returns all file paths. */
async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

/**
 * Extracts an archive after **complete** validation of its catalogue: a single dangerous entry (traversal,
 * symbolic link) or exceeded bounds invalidate the entire archive.
 */
export async function extractArchive(input: string, extractDir: string): Promise<void> {
  const { default: AdmZip } = await import('adm-zip');
  let zip: InstanceType<typeof AdmZip>;
  try {
    zip = new AdmZip(input);
  } catch (err) {
    const e = err as { message?: string };
    throw new Error(`Archive illisible : ${(e.message || 'erreur inconnue').slice(0, 300)}`, {
      cause: err,
    });
  }

  const entries: ZipEntryInfo[] = zip.getEntries().map((entry) => ({
    name: entry.entryName,
    size: entry.header.size,
    compressedSize: entry.header.compressedSize,
    isDirectory: entry.isDirectory,
    externalAttributes: entry.header.attr,
  }));

  const maxTotalBytes = env.ARCHIVE_MAX_UNCOMPRESSED_BYTES;
  const plan = planExtraction(entries, {
    maxEntries: env.ARCHIVE_MAX_ENTRIES,
    maxTotalBytes,
    maxRatio: env.ARCHIVE_MAX_COMPRESSION_RATIO,
  });
  if (plan.rejection) throw new Error(describeRejection(plan.rejection));

  // `planExtraction` can only judge the CATALOGUE: sizes there are *declared* by whoever built the archive.
  // An entry may announce 1 KB and inflate to gigabytes — `extractAllTo` would then
  // write the real bytes without checking anything, and the (validated) plan would be thrown away. We
  // therefore extract entry by entry, comparing each real size with its declaration and keeping a
  // cumulative budget.
  let written = 0;
  try {
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      // Second pass through `resolveInside`: this is the destination actually written.
      const target = resolveInside(extractDir, entry.entryName);
      if (!target) throw new Error(`Chemin d'entrée refusé : ${entry.entryName}`);

      const declared = Math.max(0, entry.header.size);
      const compressed = Math.max(0, entry.header.compressedSize);

      // ⚠ Order matters. Decompressing the WHOLE entry and then measuring is pointless if the declaration has
      // already served as a pass: an entry announcing zero bytes would cross the budget and then inflate
      // without bound. So we bound BEFORE decompressing — the cumulative budget on the declaration, the
      // memory on that same declaration (`readEntryBounded`), which becomes a ceiling instead of a promise.
      if (declared === 0 && compressed > EMPTY_ENTRY_MAX_COMPRESSED)
        throw new Error(
          `Archive refusée : l'entrée « ${entry.entryName} » se déclare vide mais pèse ${compressed} octets compressés`,
        );
      if (written + declared > maxTotalBytes)
        throw new Error(
          describeRejection({ code: 'TOO_LARGE', limit: maxTotalBytes, actual: written + declared }),
        );

      const data = readEntryBounded(entry);
      // The declaration is a commitment: deviating from it is the signature of a bomb.
      if (data.length !== declared)
        throw new Error(
          `Archive refusée : l'entrée « ${entry.entryName} » annonce ${declared} octets et en contient ${data.length}`,
        );
      written += data.length;
      if (written > maxTotalBytes)
        throw new Error(describeRejection({ code: 'TOO_LARGE', limit: maxTotalBytes, actual: written }));

      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    }
  } catch (err) {
    // Partial extraction = silently incomplete USD scene: we erase everything.
    await rm(extractDir, { recursive: true, force: true }).catch(
      ignoreFailure('model extraction dir cleanup failed', { dir: extractDir }),
    );
    const e = err as { message?: string };
    throw new Error(`Extraction de l'archive échouée : ${(e.message || 'erreur inconnue').slice(0, 300)}`, {
      cause: err,
    });
  }
}

/**
 * Designates the root layer of a USD archive. With the analyser, the dependency graph decides; without it, we
 * fall back on the heuristics of `usdArchive`.
 */
async function resolveUsdRoot(
  files: string[],
  extractDir: string,
  archiveName: string,
  fallback: string,
): Promise<string> {
  let deps;
  if (await hasUsdTools()) {
    deps = await scanUsdDirectory(extractDir, usdToolConfig()).catch((err) => {
      logger.warn({ err }, '[ModelConvert] graphe de couches USD indisponible, heuristique seule');
      return undefined;
    });
  }
  return pickUsdRootLayer(files, { deps, archiveName }) ?? fallback;
}

/** Converts a `.zip` archive: controlled extraction, choice of the main model, conversion. */
async function convertArchive(
  input: string,
  output: string,
  request: UsdRequest,
  archiveName: string,
): Promise<ConvertResult> {
  const extractDir = join(dirname(input), 'unzipped');
  await extractArchive(input, extractDir);

  const files = await walk(extractDir);
  const chosen = pickModelFile(files);
  if (!chosen) throw new Error("Aucun fichier 3D reconnu dans l'archive (gltf/glb/fbx/obj/dae/stl/usd)");

  const ext = extname(chosen).toLowerCase();
  if (ext === '.glb') {
    await copyFile(chosen, output);
    return { converter: 'copy' };
  }
  if (ext === '.gltf') {
    await convertGltfToGlb(chosen, output); // resolves scene.bin + relative textures
    return { converter: 'gltf' };
  }
  if (isUsdModel(ext)) {
    const root = await resolveUsdRoot(files, extractDir, archiveName, chosen);
    // Path **inside the archive**: this is what lets the user check that the right layer was opened among
    // several.
    const label = relative(extractDir, root).replace(/\\/g, '/');
    return convertUsd(root, output, request, dirname(input), label);
  }
  await convertWithAssimp(chosen, output); // OBJ/FBX/DAE… with adjacent resources
  return { converter: 'assimp' };
}

// ---------------------------------------------------------------------------- entry point

/**
 * Converts a 3D media into GLB and returns its provenance (chosen converter, USD description).
 * `archiveName` serves as a hint to find the root layer of a zip; `request` carries the requested
 * recomposition (variants/purpose), with no effect on non-USD formats.
 */
export async function convertToGlb(
  input: string,
  output: string,
  ext: string,
  opts: { archiveName?: string; request?: UsdRequest } = {},
): Promise<ConvertResult> {
  const e = ext.toLowerCase();
  const request = opts.request ?? DEFAULT_USD_REQUEST;
  const archiveName = opts.archiveName ?? basename(input);

  if (e === '.zip') return convertArchive(input, output, request, archiveName);
  // A `.usdz` is a USD package: `pxr` and Blender open it directly, without extraction.
  // The displayed "root layer" is then the name of the uploaded file.
  if (e === '.usdz' || isUsdModel(e)) return convertUsd(input, output, request, dirname(input), archiveName);
  if (e === '.gltf') {
    await convertGltfToGlb(input, output);
    return { converter: 'gltf' };
  }
  if (e === '.glb') {
    await copyFile(input, output);
    return { converter: 'copy' };
  }
  await convertWithAssimp(input, output);
  return { converter: 'assimp' };
}
