// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from 'adm-zip';
import { copyFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { OUT_DIR, WORK_DIR } from '../config';
import { ensureDir, exists } from '../lib/download';
import { runBlender, runPython } from '../lib/run';
import { fetchPolyHavenModel } from './models';

/**
 * Fabrication des scènes USD du projet de démonstration : un graphe d'asset par asset de
 * bibliothèque, une pile de couches par plan, le tout livré en archive `.zip` — c'est la
 * forme qui montre la segmentation, là où un `.usdz` la referme dans un paquet opaque.
 *
 * Les scripts Python font le travail USD ; ce module se charge de l'enchaînement, du cache
 * et de l'assemblage de l'archive.
 */

/** Dossier de travail des scènes USD (hors `media/` : ce sont des sources, pas des livrables). */
const USD_DIR = join(WORK_DIR, 'usd');

export interface UsdAssetSpec {
  /** Nom du prim racine et du fichier d'interface (`Lantern` → `Lantern.usda`). */
  name: string;
  /** Modèle Poly Haven (CC0) dont la géométrie est extraite. */
  polyHavenSlug: string;
  /** Échelle appliquée à l'import (les scans ne sont pas tous à l'échelle du plan). */
  scale?: number;
  /** Version affichée dans `assetInfo`. */
  version?: string;
  /** Second look, teinté et plus rugueux : c'est lui qui peuple le variantSet. */
  weatheredTint?: [number, number, number, number];
}

export interface UsdAssetResult {
  name: string;
  /** Dossier du graphe (contient l'interface, le payload, geom/, mtl/, tex/). */
  dir: string;
  /** Couche racine, relative au dossier. */
  root: string;
  variantSets: { prim: string; name: string; options: string[] }[];
  purposes: string[];
  prims: number;
  polygons: number;
}

interface GeomSummary {
  name: string;
  render: string;
  proxy: string;
  meshes: string[];
  polygons: number;
}

interface UsdSummary {
  root: string;
  defaultPrim: string | null;
  variantSets: { prim: string; name: string; options: string[] }[];
  purposes: string[];
  prims: number;
}

/** Les trois textures PBR de Poly Haven, retrouvées par leur suffixe de convention. */
function pickTextures(files: string[]): { diffuse: string; normal: string; arm: string } | null {
  const find = (suffix: string): string | undefined =>
    files.find((f) => f.includes(`_${suffix}_`) && !f.includes('_glass_'));
  const diffuse = find('diff');
  const normal = find('nor_gl');
  const arm = find('arm');
  return diffuse && normal && arm ? { diffuse, normal, arm } : null;
}

/** Construit (ou retrouve) le graphe USD complet d'un asset de bibliothèque. */
export async function buildUsdAsset(spec: UsdAssetSpec): Promise<UsdAssetResult> {
  const dir = join(USD_DIR, spec.name);
  const root = `${spec.name}.usda`;
  const model = await fetchPolyHavenModel(spec.polyHavenSlug);

  const geom = await runBlender<GeomSummary>(
    'blender_export_geom.py',
    [
      '--input',
      model.gltfPath,
      '--name',
      spec.name,
      '--outdir',
      join(dir, 'geom'),
      '--scale',
      String(spec.scale ?? 1),
    ],
    'SAMPLE_GEOM_JSON',
  );

  await ensureDir(join(dir, 'tex'));
  const texNames: string[] = [];
  for (const texture of model.textures) {
    const name = basename(texture);
    const target = join(dir, 'tex', name);
    if (!(await exists(target))) await copyFile(texture, target);
    texNames.push(name);
  }
  const textures = pickTextures(texNames);
  if (!textures) throw new Error(`${spec.name}: incomplete PBR texture set (diff/nor_gl/arm expected)`);

  const specFile = join(WORK_DIR, 'spec', `asset-${spec.name}.json`);
  await ensureDir(dirname(specFile));
  await writeFile(
    specFile,
    JSON.stringify(
      {
        name: spec.name,
        assetDir: dir.replace(/\\/g, '/'),
        version: spec.version ?? 'v001',
        textures: {
          diffuse: `../tex/${textures.diffuse}`,
          normal: `../tex/${textures.normal}`,
          arm: `../tex/${textures.arm}`,
        },
        geom: { render: geom.render, proxy: geom.proxy },
        looks: [
          { name: 'clean', tint: [1, 1, 1, 1], roughnessScale: 1 },
          { name: 'weathered', tint: spec.weatheredTint ?? [0.6, 0.55, 0.48, 1], roughnessScale: 1.4 },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  const summary = await runPython<UsdSummary>('build_usd_asset.py', [specFile], 'SAMPLE_USD_JSON');
  return {
    name: spec.name,
    dir,
    root,
    variantSets: summary.variantSets,
    purposes: summary.purposes,
    prims: summary.prims,
    polygons: geom.polygons,
  };
}

/** Placement d'un asset dans un plan. */
export interface ShotAssetPlacement {
  asset: string;
  prim: string;
  group?: 'sets' | 'props' | 'chars';
  translate?: [number, number, number];
  rotate?: [number, number, number];
  scale?: number;
  anim?: { translate?: Record<string, number[]>; rotate?: Record<string, number[]> };
}

export interface UsdShotSpec {
  shot: string;
  start: number;
  end: number;
  fps?: number;
  assets: ShotAssetPlacement[];
  camera?: {
    focal: number;
    aspect?: number;
    translate?: [number, number, number];
    rotate?: [number, number, number];
    anim?: { translate?: Record<string, number[]>; rotate?: Record<string, number[]> };
    focalAnim?: Record<string, number>;
  };
  lights?: {
    name: string;
    type: 'DistantLight' | 'DomeLight' | 'RectLight';
    intensity?: number;
    color?: [number, number, number];
    rotate?: [number, number, number];
    translate?: [number, number, number];
  }[];
  fx?: {
    name: string;
    type?: 'Sphere';
    radius?: number;
    translate?: [number, number, number];
    color?: [number, number, number];
    opacity?: number;
  }[];
}

export interface UsdShotResult {
  shot: string;
  dir: string;
  /** Archive livrable, dans `media/`. */
  archive: string;
  layerCount: number;
  prims: number;
}

/** Copie récursive d'un dossier (les graphes d'assets entrent tels quels dans l'archive). */
async function copyTree(from: string, to: string): Promise<void> {
  await ensureDir(to);
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) await copyTree(source, target);
    else if (!(await exists(target))) await copyFile(source, target);
  }
}

/**
 * Construit la scène d'un plan et l'archive.
 *
 * Les assets référencés sont **recopiés dans l'archive** : une livraison USD doit être
 * autoportante, sinon la review ouvre une scène dont la moitié des références manquent —
 * ce que `analyze_usd.py` signalerait en `missingAssets`.
 */
export async function buildUsdShot(
  spec: UsdShotSpec,
  assets: Map<string, UsdAssetResult>,
  archiveRelPath: string,
): Promise<UsdShotResult> {
  const dir = join(USD_DIR, 'shots', spec.shot);
  const used = new Set(spec.assets.map((a) => a.asset));
  for (const name of used) {
    const asset = assets.get(name);
    if (!asset) throw new Error(`${spec.shot}: unknown asset ${name}`);
    await copyTree(asset.dir, join(dir, 'assets', name));
  }

  const specFile = join(WORK_DIR, 'spec', `shot-${spec.shot}.json`);
  await ensureDir(dirname(specFile));
  await writeFile(
    specFile,
    JSON.stringify(
      {
        shot: spec.shot,
        shotDir: dir.replace(/\\/g, '/'),
        start: spec.start,
        end: spec.end,
        fps: spec.fps ?? 24,
        assets: spec.assets.map((a) => ({
          name: a.asset,
          prim: a.prim,
          group: a.group ?? 'props',
          path: `assets/${a.asset}/${assets.get(a.asset)!.root}`,
          translate: a.translate ?? [0, 0, 0],
          rotate: a.rotate ?? [0, 0, 0],
          scale: a.scale ?? 1,
          ...(a.anim ? { anim: a.anim } : {}),
        })),
        ...(spec.camera ? { camera: spec.camera } : {}),
        lights: spec.lights ?? [],
        fx: spec.fx ?? [],
      },
      null,
      2,
    ),
    'utf8',
  );

  const summary = await runPython<{ prims: number }>('build_usd_shot.py', [specFile], 'SAMPLE_USD_JSON');
  const archive = join(OUT_DIR, archiveRelPath);
  await ensureDir(dirname(archive));
  const zip = new AdmZip();
  zip.addLocalFolder(dir);
  zip.writeZip(archive);

  return { shot: spec.shot, dir, archive, layerCount: used.size * 6 + 4, prims: summary.prims };
}

/** Archive le graphe d'un asset seul (livrable de la tâche de modeling/lookdev). */
export async function zipUsdAsset(asset: UsdAssetResult, archiveRelPath: string): Promise<string> {
  const archive = join(OUT_DIR, archiveRelPath);
  await ensureDir(dirname(archive));
  const zip = new AdmZip();
  zip.addLocalFolder(asset.dir);
  zip.writeZip(archive);
  return archive;
}
