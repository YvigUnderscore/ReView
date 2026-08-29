// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { join } from 'node:path';
import { CACHE_DIR } from '../config';
import { download, fetchJson } from '../lib/download';

/**
 * Récupération des modèles source (Poly Haven, CC0) qui servent de base aux assets 3D du
 * projet de démonstration.
 *
 * On prend la déclinaison **glTF 1k** : c'est le plus petit paquet complet (géométrie
 * binaire + textures PBR), et c'est le seul que Blender relit sans dépendre d'un moteur de
 * rendu particulier. Les fichiers restent dans `dev_data/` — rien n'entre dans le dépôt.
 */

/** Réponse de `https://api.polyhaven.com/files/<slug>` (partie utile). */
interface PolyHavenFiles {
  gltf?: Record<string, { gltf?: { url: string; include?: Record<string, { url: string }> } }>;
  hdri?: Record<string, { hdr?: { url: string }; exr?: { url: string } }>;
}

export interface FetchedModel {
  slug: string;
  /** Chemin local du `.gltf` (ses dépendances sont posées à côté, chemins relatifs intacts). */
  gltfPath: string;
  /** Textures récupérées, chemins locaux. */
  textures: string[];
}

/**
 * Télécharge un modèle Poly Haven et ses dépendances en respectant l'arborescence relative
 * déclarée dans le glTF (`textures/…`, `.bin`) : sans cela, le fichier s'ouvre sans matière.
 */
export async function fetchPolyHavenModel(slug: string, resolution = '1k'): Promise<FetchedModel> {
  const files = await fetchJson<PolyHavenFiles>(`https://api.polyhaven.com/files/${slug}`);
  const entry = files.gltf?.[resolution]?.gltf;
  if (!entry) throw new Error(`no glTF ${resolution} for ${slug}`);

  const base = join('models', slug);
  const gltfPath = await download(entry.url, join(base, `${slug}_${resolution}.gltf`));
  const textures: string[] = [];
  for (const [rel, file] of Object.entries(entry.include ?? {})) {
    const local = await download(file.url, join(base, rel));
    if (rel.startsWith('textures/')) textures.push(local);
  }
  return { slug, gltfPath, textures };
}

/** Télécharge un HDRI Poly Haven (CC0) pour la bibliothèque d'éclairage du studio. */
export async function fetchPolyHavenHdri(slug: string, resolution = '1k'): Promise<string> {
  const files = await fetchJson<PolyHavenFiles>(`https://api.polyhaven.com/files/${slug}`);
  const entry = files.hdri?.[resolution];
  const url = entry?.hdr?.url ?? entry?.exr?.url;
  if (!url) throw new Error(`no HDRI ${resolution} for ${slug}`);
  const ext = url.endsWith('.exr') ? 'exr' : 'hdr';
  return download(url, join('hdris', `${slug}_${resolution}.${ext}`));
}

/**
 * Modèle glTF d'exemple Khronos. `Fox` (CC0) porte une animation squelettique : c'est le
 * seul moyen de montrer, dans le jeu de démonstration, un GLB animé et son sélecteur
 * d'animations.
 */
export async function fetchKhronosModel(name: string, file: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/${name}/glTF-Binary/${file}`;
  return download(url, join('khronos', file));
}

/** Chemin du cache d'un modèle (les scripts Python travaillent à côté des fichiers). */
export const modelCacheDir = (slug: string): string => join(CACHE_DIR, 'models', slug);
