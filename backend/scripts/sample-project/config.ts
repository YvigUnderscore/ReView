// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { resolve } from 'node:path';

/**
 * Sample project — sources et constantes.
 *
 * Tout le contenu du projet de démonstration est **libre** : films Blender Open Movies
 * (CC-BY), modèles et HDRI Poly Haven (CC0), modèles d'exemple Khronos (CC0/CC-BY). Aucune
 * source propriétaire, aucun fichier commité : les médias sont récupérés à la demande dans
 * `dev_data/sample-project/` (ignoré par git) puis découpés/convertis sur place.
 *
 * Chaque source porte son attribution ici, et c'est cette table qui écrit `ATTRIBUTION.md`
 * à la fin de la génération : la licence CC-BY oblige à créditer, y compris pour un jeu de
 * démonstration.
 */

/** Racine du dépôt (le script vit dans backend/scripts/sample-project/). */
export const REPO_ROOT = resolve(__dirname, '..', '..', '..');

/** Espace de travail : cache des téléchargements + fichiers produits. Gitignoré (dev_data/). */
export const WORK_DIR = resolve(REPO_ROOT, 'dev_data', 'sample-project');
export const CACHE_DIR = resolve(WORK_DIR, 'cache');
export const OUT_DIR = resolve(WORK_DIR, 'media');

/** API du backend (stack docker de développement). */
export const API_BASE = process.env.SAMPLE_API_BASE ?? 'http://localhost:3430/api';

/** Mot de passe unique des comptes de démonstration (développement local uniquement). */
export const SAMPLE_PASSWORD = 'sample1234';

/** Œuvre source : ce qui doit être cité, et sous quelle licence. */
export interface SourceWork {
  key: string;
  title: string;
  authors: string;
  license: string;
  licenseUrl: string;
  homepage: string;
}

export const WORKS: Record<string, SourceWork> = {
  caminandes: {
    key: 'caminandes',
    title: 'Caminandes: Llama Drama / Gran Dillama / Llamigos (2013-2016)',
    authors: 'Blender Foundation — Beorn Leonard, Pablo Vazquez',
    license: 'CC BY 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    homepage: 'https://studio.blender.org/films/caminandes-3/',
  },
  polyHaven: {
    key: 'polyHaven',
    title: 'Poly Haven models, textures and HDRIs',
    authors: 'Poly Haven contributors',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    homepage: 'https://polyhaven.com/',
  },
  khronos: {
    key: 'khronos',
    title: 'glTF Sample Assets',
    authors: 'Khronos Group and contributors',
    license: 'CC0 1.0 / CC BY 4.0 (per asset)',
    licenseUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/LICENSE.md',
    homepage: 'https://github.com/KhronosGroup/glTF-Sample-Assets',
  },
};

/** Film source : une URL lisible en HTTP range, ffmpeg y prélève les plans. */
export interface FilmSource {
  work: string;
  url: string;
  /** Cadence du master, pour convertir un timecode en numéro d'image. */
  fps: number;
}

/**
 * Masters des épisodes.
 *
 * Ils sont téléchargés **une fois** puis découpés sur place (`build/segments`) : chaque plan
 * porte une dizaine de versions tirées des mêmes secondes, et aller les chercher à distance
 * une par une revenait à faire du serveur d'archive un banc d'essai.
 */
export const FILMS: Record<string, FilmSource> = {
  caminandes1: {
    work: 'caminandes',
    url: 'https://archive.org/download/caminandes-1-llama-drama/1_Caminandes1_Llama_Drama_720p_vp8.ogv',
    fps: 24,
  },
  caminandes2: {
    work: 'caminandes',
    url: 'https://archive.org/download/caminandes-2-gran-dillama/1_Caminandes2_Gran_Dillama_720p_vp8.ogv',
    fps: 24,
  },
  caminandes3: {
    work: 'caminandes',
    url: 'https://archive.org/download/caminandes-3-llamigos/1_Caminandes3_Llamigos_720p_vp8.ogv',
    fps: 24,
  },
};

/** Modèle Poly Haven (CC0) : glTF 1k + textures, base des assets USD et des splats. */
export interface ModelSource {
  slug: string;
  /** Nom de l'asset tel qu'il apparaît dans le projet de démonstration. */
  label: string;
}

export const POLY_HAVEN_MODELS: ModelSource[] = [
  { slug: 'namaqualand_rocks_01', label: 'Rock Set' },
  { slug: 'dead_tree_trunk', label: 'Dead Tree' },
  { slug: 'wooden_crate_01', label: 'Mine Props' },
  { slug: 'rock_moss_set_01', label: 'Ground scan' },
];

/** HDRI Poly Haven (CC0) versés dans la bibliothèque d'éclairage du studio. */
export const POLY_HAVEN_HDRIS = ['kloofendal_43d_clear_puresky', 'moonless_golf', 'studio_small_09'];

/** Cadence et résolution de référence du studio de démonstration. */
export const STUDIO_FPS = 24;
export const STUDIO_RESOLUTION = { width: 1920, height: 1080 };
