// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { join } from 'node:path';
import { OUT_DIR } from '../config';
import { ensureDir, exists } from '../lib/download';
import { runBlender } from '../lib/run';
import { fetchPolyHavenModel } from './models';

/**
 * Fabrication des Gaussian Splats du projet de démonstration.
 *
 * Ils sont **produits ici**, à partir de scans photogrammétriques CC0, plutôt qu'empruntés
 * aux jeux d'entraînement des articles de recherche : ces derniers sont diffusés pour la
 * recherche seule, et le projet de démonstration doit rester intégralement libre. Le
 * fichier écrit est un 3DGS standard (`.ply`, mêmes propriétés que l'implémentation de
 * référence), lu tel quel par le viewer Spark.
 */

export interface SplatSpec {
  /** Modèle Poly Haven (CC0) — de préférence un scan. */
  polyHavenSlug: string;
  /** Chemin de sortie, relatif à `media/`. */
  out: string;
  /** Nombre de gaussiennes visées. */
  count?: number;
  scale?: number;
}

export interface SplatResult {
  path: string;
  splats: number;
  bytes: number;
}

export async function buildSplat(spec: SplatSpec): Promise<SplatResult> {
  const target = join(OUT_DIR, spec.out);
  await ensureDir(join(target, '..'));
  if (await exists(target)) {
    return { path: target, splats: 0, bytes: 0 };
  }
  const model = await fetchPolyHavenModel(spec.polyHavenSlug);
  const summary = await runBlender<{ splats: number; bytes: number }>(
    'blender_make_splat.py',
    [
      '--input',
      model.gltfPath,
      '--output',
      target,
      '--count',
      String(spec.count ?? 200000),
      '--scale',
      String(spec.scale ?? 1),
    ],
    'SAMPLE_SPLAT_JSON',
  );
  return { path: target, splats: summary.splats, bytes: summary.bytes };
}
