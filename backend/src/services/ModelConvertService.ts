// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, dirname, extname, join, relative } from 'node:path';
import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

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

/**
 * Conversion des médias 3D vers GLB — seul format lu par le viewer Three.js de la review.
 * Extrait de `workers/ffmpeg.worker.ts` en Phase 45 (45.C) : la logique métier appartient aux
 * services, et le worker dépassait largement une taille lisible.
 *
 * Aiguillage : `.glb` copié tel quel, `.gltf` packé en JS, USD via Blender (OpenUSD complet),
 * le reste via assimp. Les archives (`.zip`) sont extraites sous contrôle strict (`lib/zipSafety`)
 * puis re-aiguillées sur leur fichier principal ; un `.usdz` est ouvert directement par les outils
 * USD, sans extraction de notre part.
 *
 * Le fichier source n'est jamais modifié : tout est produit dans le répertoire temporaire du job.
 */

const execFileAsync = promisify(execFile);

/**
 * Taux d'expansion maximal du format DEFLATE (~1032:1). Borne *physique*, contrairement à
 * `ARCHIVE_MAX_COMPRESSION_RATIO` qui est un réglage de politique : c'est elle qu'il faut
 * pour estimer le pire cas d'une entrée AVANT de la décompresser.
 */
const DEFLATE_MAX_RATIO = 1032;

/** Un fichier réellement vide tient en un bloc DEFLATE vide ; au-delà, la déclaration ment. */
const EMPTY_ENTRY_MAX_COMPRESSED = 16;

/** Options d'exécution communes : timeout obligatoire, sortie bornée, pas de fenêtre Windows. */
const runOpts = () => ({
  timeout: env.MODEL_CONVERT_TIMEOUT_MS,
  maxBuffer: 32 * 1024 * 1024,
  windowsHide: true as const,
});

/** Recomposition demandée par l'utilisateur (Phase 45, 45.E) — variantes + purpose USD. */
export interface UsdRequest {
  variants: UsdVariantSelection;
  purpose: UsdPurpose;
}

/** Bloc `metadata.model.usd` exposé en fiche technique et consommé par la route de recomposition. */
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
  /** Ce qui a été demandé… */
  selection: UsdRequest;
  /** …et si le convertisseur retenu a pu l'appliquer (seul Blender le peut). */
  selectionApplied: boolean;
  missingAssets: string[];
  missingAssetsTotal: number;
  layerCount: number;
  primCount: number;
  /** Scenegraph (46.A) : arbre de prims à plat, y compris les prims non rendus. */
  prims: UsdPrim[];
  primsTruncated: boolean;
}

export interface ConvertResult {
  converter: ModelConverter;
  usd?: UsdModelInfo;
  blender?: BlenderSummary;
}

export const DEFAULT_USD_REQUEST: UsdRequest = { variants: {}, purpose: 'render' };

// ---------------------------------------------------------------------------- outillage USD

/**
 * Localise un script Python du worker. Les `.py` ne passent pas par `tsc` : ils restent dans
 * `src/workers/usd/` (présent dans l'image, `COPY . .`) alors que le code exécuté vit dans `dist/`.
 */
function resolveUsdScript(name: string): string {
  // Chemin de référence dans l'image : le worker tourne depuis `dist/`, les scripts vivent
  // dans `src/` (copiés tels quels par le Dockerfile).
  const packaged = join(__dirname, '..', '..', 'src', 'workers', 'usd', name);
  const candidates = [
    join(__dirname, '..', 'workers', 'usd', name), // dist/workers/usd (si copié un jour)
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

/** Sondes d'outillage mises en cache : inutile de relancer un binaire à chaque job. */
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

/** Binaire du convertisseur USD natif de repli (`guc`), ou undefined. */
const usdConverterBin = (): string | undefined => env.USD_GLTF_CONVERTER?.trim() || undefined;

/** Message d'erreur exploitable à partir d'un échec `execFile` (timeout inclus). */
function describeExecError(err: unknown, who: string): string {
  const e = err as { killed?: boolean; stderr?: string; stdout?: string; message?: string };
  if (e.killed) return `${who} : délai dépassé (${Math.round(env.MODEL_CONVERT_TIMEOUT_MS / 1000)} s)`;
  const detail = (e.stderr || e.stdout || e.message || '').toString().trim();
  return `${who} : ${summarizeBlenderError(detail) || 'erreur inconnue'}`;
}

// ---------------------------------------------------------------------------- convertisseurs

/** Vérifie que le GLB a bien été produit et n'est pas vide. */
async function assertGlbProduced(output: string, who: string): Promise<void> {
  const info = await stat(output).catch(() => null);
  if (!info || info.size === 0) throw new Error(`${who} conversion: the output GLB is empty or missing`);
}

/** Convertit un .gltf (texte, buffers et textures relatifs) en .glb binaire via gltf-import-export. */
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

/** Convertit un modèle 3D (FBX/OBJ/DAE/STL…) en GLB via assimp. */
async function convertWithAssimp(input: string, output: string): Promise<void> {
  try {
    await execFileAsync('assimp', ['export', input, output, '-f', 'glb2'], runOpts());
  } catch (err) {
    throw new Error(describeExecError(err, 'assimp conversion failed'), { cause: err });
  }
  await assertGlbProduced(output, 'assimp');
}

/**
 * Prépare une couche d'overlay par **option de variante non sélectionnée** (46.G) : chaque
 * option est ensuite importée par Blender et cuite dans le GLB, ce qui rend la bascule
 * instantanée en review — et donc possible après publication, sans reconversion.
 *
 * Le coût est additif : chaque option est composée avec les autres jeux de variantes à leur
 * valeur courante, on ne produit pas le produit cartésien des combinaisons.
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
      if (option === current) continue; // déjà présent dans la scène de base
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
        // Sans les matériaux rangés hors du sous-arbre, l'option cuite ressort sans liaison.
        mask: buildVariantMask(set.prim, info.materialPaths),
      });
    }
  }
  if (entries.length === 0) return [];

  // Une seule invocation pour toutes les couches (46.P) : l'ancienne préparation composait la
  // scène une fois par option — prohibitif dès des dizaines de jeux de variantes.
  try {
    await writeVariantOverlays(source, overlays, usdToolConfig(), join(workDir, 'variant-overlays.json'));
  } catch (err) {
    logger.warn({ err }, '[ModelConvert] couches de variantes non écrites — cuisson sautée');
    return [];
  }
  return entries;
}

/** Convertit une scène USD via Blender headless (OpenUSD complet : composition, matériaux, anim). */
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
    // La cuisson ne doit jamais faire expirer la conversion : elle se coupe elle-même à la
    // moitié du timeout et laisse les options restantes en `variantsSkipped` (46.P).
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
 * Construit le bloc de métadonnées USD exposé en review. `rootLayer` est **imposé** par
 * l'appelant : le worker travaille sur une copie nommée `src.usdz`, ce nom technique n'aurait
 * aucun sens en fiche technique. Pour une archive, l'appelant passe le chemin dans l'archive.
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
 * Analyse une scène USD puis la convertit. L'analyse est *best effort* : sans outillage `pxr`,
 * on convertit quand même (sans fiche technique USD ni rapport d'assets manquants).
 */
async function convertUsd(
  input: string,
  output: string,
  request: UsdRequest,
  workDir: string,
  /** Nom affiché de la couche racine : nom d'origine du média, ou chemin dans l'archive. */
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

    // Recomposition : on n'écrit jamais dans le fichier d'origine — la sélection de variantes
    // passe par une couche d'overlay qui sous-couche la racine (façon USD).
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
    // Cuisson des variantes (46.G) : chaque option devient un sous-arbre du GLB, la bascule
    // se fait ensuite cote client — instantanee et disponible apres publication.
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

  // Replis : `guc` (matériaux fidèles, géométrie statique) puis assimp. Ni l'un ni l'autre
  // n'applique variantes ou purpose — `selectionApplied` reste faux.
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

// ---------------------------------------------------------------------------- vignette

/** Issue d'un rendu de vignette : jamais une exception — une vignette absente n'est pas un échec. */
export interface ModelThumbResult {
  rendered: boolean;
  /** Motif exploitable en journal quand rien n'a été rendu (`blender-missing`, `no-geometry`…). */
  reason: string;
}

/**
 * Rend une vignette PNG (fond transparent) d'un GLB via Blender headless.
 *
 * **Ne lève jamais** et ne touche à rien d'autre que le fichier de sortie : le job de
 * vignette est décoratif, il ne doit ni bloquer la publication ni faire passer un média en
 * échec. Blender absent de l'image (build sans `INSTALL_USD_TOOLS`) est un cas nominal :
 * on renvoie `blender-missing`, l'appelant journalise, et la capture côté client au premier
 * affichage (`setAutoThumbnail`) reste le filet de sécurité.
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

/** Parcourt récursivement un dossier et renvoie tous les chemins de fichiers. */
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
 * Extrait une archive après validation **intégrale** de son catalogue : une seule entrée
 * dangereuse (traversée, lien symbolique) ou des bornes dépassées invalident l'archive entière.
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

  // `planExtraction` ne peut juger que le CATALOGUE : les tailles y sont *déclarées* par
  // celui qui a fabriqué l'archive. Une entrée peut annoncer 1 Ko et se détendre en
  // gigaoctets — `extractAllTo` écrirait alors les octets réels sans rien vérifier, et le
  // plan (pourtant validé) serait jeté. On extrait donc entrée par entrée, en confrontant
  // chaque taille réelle à sa déclaration et en tenant un budget cumulé.
  let written = 0;
  try {
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      // Second passage par `resolveInside` : c'est la destination réellement écrite.
      const target = resolveInside(extractDir, entry.entryName);
      if (!target) throw new Error(`Chemin d'entrée refusé : ${entry.entryName}`);

      const declared = Math.max(0, entry.header.size);
      const compressed = Math.max(0, entry.header.compressedSize);

      // ⚠ L'ordre compte. `getData()` décompresse l'entrée ENTIÈRE en mémoire avant qu'on
      // puisse mesurer quoi que ce soit : confronter la taille réelle à la déclaration ne
      // sert à rien si la déclaration a déjà servi de laissez-passer. Une entrée annonçant
      // zéro octet passait ainsi tous les contrôles puis se détendait sans borne.
      // On borne donc AVANT de décompresser, sur ce que le format autorise au pire.
      if (declared === 0 && compressed > EMPTY_ENTRY_MAX_COMPRESSED)
        throw new Error(
          `Archive refusée : l'entrée « ${entry.entryName} » se déclare vide mais pèse ${compressed} octets compressés`,
        );
      const worstCase = Math.max(declared, compressed * DEFLATE_MAX_RATIO);
      if (written + worstCase > maxTotalBytes)
        throw new Error(
          describeRejection({ code: 'TOO_LARGE', limit: maxTotalBytes, actual: written + worstCase }),
        );

      const data = entry.getData();
      // La déclaration est un engagement : s'en écarter est la signature d'une bombe.
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
    // Extraction partielle = scène USD silencieusement incomplète : on efface tout.
    await rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
    const e = err as { message?: string };
    throw new Error(`Extracting the'archive échouée : ${(e.message || 'erreur inconnue').slice(0, 300)}`, {
      cause: err,
    });
  }
}

/**
 * Désigne la couche racine d'une archive USD. Avec l'analyseur, le graphe de dépendances tranche ;
 * sans lui, on retombe sur les heuristiques de `usdArchive`.
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

/** Convertit une archive `.zip` : extraction contrôlée, choix du modèle principal, conversion. */
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
    await convertGltfToGlb(chosen, output); // résout scene.bin + textures relatifs
    return { converter: 'gltf' };
  }
  if (isUsdModel(ext)) {
    const root = await resolveUsdRoot(files, extractDir, archiveName, chosen);
    // Chemin **dans l'archive** : c'est ce qui permet à l'utilisateur de vérifier que la
    // bonne couche a été ouverte parmi plusieurs.
    const label = relative(extractDir, root).replace(/\\/g, '/');
    return convertUsd(root, output, request, dirname(input), label);
  }
  await convertWithAssimp(chosen, output); // OBJ/FBX/DAE… avec ressources adjacentes
  return { converter: 'assimp' };
}

// ---------------------------------------------------------------------------- point d'entrée

/**
 * Convertit un média 3D en GLB et renvoie la provenance (convertisseur retenu, description USD).
 * `archiveName` sert d'indice pour retrouver la couche racine d'un zip ; `request` porte la
 * recomposition demandée (variantes/purpose), sans effet sur les formats non USD.
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
  // Un `.usdz` est un paquet USD : `pxr` et Blender l'ouvrent directement, sans extraction.
  // Un `.usdz` est un paquet USD : `pxr` et Blender l'ouvrent directement, sans extraction.
  // La « couche racine » affichée est alors le nom du fichier uploadé.
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
