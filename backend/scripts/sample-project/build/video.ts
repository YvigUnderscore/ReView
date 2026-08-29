// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FILMS, OUT_DIR, WORK_DIR } from '../config';
import { ensureDir, exists, existsWithMinSize, ffmpeg } from '../lib/download';
import { ensureSegment } from './segments';

/**
 * Poids minimal d'un livrable valide.
 *
 * Un plan de cinq secondes encodé en 1280 pèse plusieurs centaines de kilooctets, une image
 * fixe quelques dizaines. En dessous, le fichier n'est pas un livrable : c'est le résidu
 * d'un encodage qui n'a rien reçu, et il faut le refaire plutôt que le déposer.
 */
const MIN_CLIP_BYTES = 20_000;
const MIN_STILL_BYTES = 5_000;

/**
 * Fabrication des plans vidéo du projet de démonstration.
 *
 * Les masters des films Blender ne sont jamais téléchargés : `ffmpeg -ss` les lit par
 * plages d'octets et n'extrait que les secondes du plan. Chaque version d'un plan est
 * ensuite **traitée** pour ressembler à l'étape de pipeline qu'elle représente — un layout
 * n'a pas l'image d'un comp final, et c'est ce qui rend la comparaison A/B parlante.
 */

/** Étape de pipeline dont la version imite le rendu. */
export type Look = 'plate' | 'layout' | 'blocking' | 'anim' | 'lookdev' | 'lighting' | 'comp';

export interface ClipSpec {
  /** Clé de `FILMS`. */
  film: keyof typeof FILMS;
  /** Point d'entrée dans le master (secondes). */
  start: number;
  /** Durée du plan (secondes). */
  duration: number;
  /** Chemin de sortie, relatif à `dev_data/sample-project/media/`. */
  out: string;
  look: Look;
  /** Ligne de burn-in (bas gauche) ; absente = pas de burn-in. */
  label?: string;
  /** Première image du plan, affichée dans le compteur de burn-in. */
  startFrame?: number;
  width?: number;
}

/** Police du burn-in, copiée dans l'espace de travail : ffmpeg refuse un chemin `C:/…`. */
const FONT_FILE = 'burnin-font.ttf';
const SYSTEM_FONT = 'C:/Windows/Fonts/consola.ttf';

let fontReady: Promise<void> | null = null;

async function ensureFont(): Promise<void> {
  fontReady ??= (async () => {
    await ensureDir(WORK_DIR);
    const target = join(WORK_DIR, FONT_FILE);
    if (!(await exists(target))) await copyFile(SYSTEM_FONT, target);
  })();
  return fontReady;
}

/** Chaîne de filtres propre à l'étape imitée. */
function lookFilters(look: Look): string[] {
  switch (look) {
    case 'plate':
      // Rushes non étalonnés : plus plats et plus froids que le rendu final.
      return ['eq=contrast=0.88:saturation=0.72:brightness=0.02', 'colorbalance=bs=0.06'];
    case 'layout':
      // Previz : géométrie grise, aucune information de matière.
      return ['format=gray', 'eq=contrast=0.72:brightness=0.06', 'gblur=sigma=0.6'];
    case 'blocking':
      // Blocking en poses tenues : une image sur trois, dupliquée pour garder la cadence.
      return ['format=gray', 'eq=contrast=0.8', 'fps=8', 'fps=24'];
    case 'anim':
      // Playblast d'animation : niveaux de gris, contraste franc.
      return ['format=gray', 'eq=contrast=0.95:brightness=0.03'];
    case 'lookdev':
      // Tourelle de lookdev : couleur mais éclairage neutre de studio.
      return ['eq=contrast=0.95:saturation=0.9'];
    case 'lighting':
      // Rendu lighting non étalonné.
      return ['eq=contrast=0.98:saturation=0.95'];
    case 'comp':
    default:
      return [];
  }
}

/** Burn-in de dailies : plan/tâche/version à gauche, compteur d'images à droite. */
function burnIn(label: string, startFrame: number): string[] {
  const box = `box=1:boxcolor=black@0.45:boxborderw=10:fontcolor=white@0.92:fontsize=22:fontfile=${FONT_FILE}`;
  const counter = `%{eif\\:n+${startFrame}\\:d\\:4}`;
  return [
    `drawtext=text='${label}':x=28:y=h-44:${box}`,
    `drawtext=text='${counter}':x=w-tw-28:y=h-44:${box}`,
  ];
}

/**
 * Extrait et traite un plan. Idempotent : un fichier déjà produit n'est pas refait, ce qui
 * rend la génération complète relançable sans re-télécharger les masters.
 */
export async function makeClip(spec: ClipSpec): Promise<string> {
  const target = join(OUT_DIR, spec.out);
  if (await existsWithMinSize(target, MIN_CLIP_BYTES)) return target;
  await ensureDir(join(target, '..'));
  await ensureFont();

  const film = FILMS[spec.film];
  if (!film) throw new Error(`unknown film: ${String(spec.film)}`);
  const width = spec.width ?? 1280;
  const filters = [
    `scale=${width}:-2:flags=lanczos`,
    ...lookFilters(spec.look),
    ...(spec.label ? burnIn(spec.label, spec.startFrame ?? 1001) : []),
    'format=yuv420p',
  ];

  // Toutes les versions d'un plan dérivent du même segment prélevé une fois.
  const segment = await ensureSegment(spec.film, spec.start, spec.duration);

  await ffmpeg(
    [
      '-ss',
      String(spec.start - segment.start),
      '-i',
      segment.path,
      '-t',
      String(spec.duration),
      // La vidéo, et rien d'autre. Les masters traînent des pistes de données (chapitres,
      // pièces jointes) que ffmpeg recopie par défaut : le fichier paraît normal, puis le
      // transcodage HLS produit un flux à deux pistes vidéo que le lecteur refuse
      // silencieusement — écran noir, aucune erreur, nulle part.
      '-map',
      '0:v:0',
      '-an',
      '-sn',
      '-dn',
      '-map_chapters',
      '-1',
      '-map_metadata',
      '-1',
      '-vf',
      filters.join(','),
      '-r',
      String(film.fps),
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '20',
      '-movflags',
      '+faststart',
      target,
    ],
    WORK_DIR,
  );
  return target;
}

/** Extrait une image fixe d'un film (rendu, plaque de référence, planche de style). */
export async function makeStill(spec: {
  film: keyof typeof FILMS;
  at: number;
  out: string;
  look?: Look;
  width?: number;
  extraFilters?: string[];
}): Promise<string> {
  const target = join(OUT_DIR, spec.out);
  if (await existsWithMinSize(target, MIN_STILL_BYTES)) return target;
  await ensureDir(join(target, '..'));
  const film = FILMS[spec.film];
  if (!film) throw new Error(`unknown film: ${String(spec.film)}`);
  const filters = [
    `scale=${spec.width ?? 1920}:-2:flags=lanczos`,
    ...(spec.look ? lookFilters(spec.look) : []),
    ...(spec.extraFilters ?? []),
  ];
  const segment = await ensureSegment(spec.film, spec.at, 1);
  await ffmpeg(
    [
      '-ss',
      String(spec.at - segment.start),
      '-i',
      segment.path,
      '-frames:v',
      '1',
      '-vf',
      filters.join(','),
      target,
    ],
    WORK_DIR,
  );
  return target;
}

/**
 * Extrait une séquence d'images numérotée (`SH0100_comp_v003.1001.png`, …) — le livrable
 * réel du compositing, que ReView reçoit frame par frame et réassemble en un seul média.
 */
export async function makeFrames(spec: {
  film: keyof typeof FILMS;
  start: number;
  count: number;
  dir: string;
  pattern: string;
  startFrame: number;
  look?: Look;
  width?: number;
}): Promise<string[]> {
  const dir = join(OUT_DIR, spec.dir);
  await ensureDir(dir);
  const film = FILMS[spec.film];
  if (!film) throw new Error(`unknown film: ${String(spec.film)}`);
  const names = Array.from({ length: spec.count }, (_, i) =>
    spec.pattern.replace('%04d', String(spec.startFrame + i).padStart(4, '0')),
  );
  const first = join(dir, names[0]!);
  if (!(await exists(first))) {
    const filters = [
      `scale=${spec.width ?? 1280}:-2:flags=lanczos`,
      ...(spec.look ? lookFilters(spec.look) : []),
    ];
    const segment = await ensureSegment(spec.film, spec.start, spec.count / film.fps + 1);
    await ffmpeg(
      [
        '-ss',
        String(spec.start - segment.start),
        '-i',
        segment.path,
        '-frames:v',
        String(spec.count),
        '-vf',
        filters.join(','),
        '-start_number',
        String(spec.startFrame),
        join(dir, spec.pattern),
      ],
      WORK_DIR,
    );
  }
  return names.map((n) => join(dir, n));
}
