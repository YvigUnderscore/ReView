// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CACHE_DIR, FILMS } from '../config';
import { download, ensureDir, exists, ffmpeg, ffprobe } from '../lib/download';

/**
 * Segments source : le morceau de film d'un plan, prélevé **une seule fois**.
 *
 * Un plan porte huit à dix versions (layout, blocking, animation, lighting, comp…), toutes
 * tirées des mêmes secondes du master. Aller les chercher à distance pour chacune d'elles
 * multipliait les requêtes par dix et se terminait en `429 Too Many Requests` : le serveur
 * de la Blender Foundation n'a pas à servir de banc d'essai.
 *
 * Le master est donc **téléchargé une fois**, puis découpé sur place : un plan devient un
 * segment local un peu plus large que lui, et ses dix versions en dérivent instantanément.
 * Prélever à distance plan par plan revenait à demander deux cents lectures partielles d'un
 * fichier d'un gigaoctet, ce qu'aucun hébergeur n'accepte longtemps — et ce qu'aucun projet
 * libre ne devrait faire subir à celui qui héberge ses films.
 */

/** Marge avant et après le plan : elle couvre les vignettes et les images fixes. */
const PRE_ROLL = 2;
const POST_ROLL = 4;

/** Progression des reprises quand le serveur refuse une requête. */
const RETRY_DELAYS_MS = [10000, 45000, 120000];

export interface Segment {
  path: string;
  /** Instant du master auquel commence le segment (secondes). */
  start: number;
  end: number;
}

const registry = new Map<string, Segment[]>();
/** Masters déjà téléchargés, par film. */
const masters = new Map<string, string>();
let loaded = false;
let chain: Promise<unknown> = Promise.resolve();

const segmentDir = (): string => join(CACHE_DIR, 'segments');

/** `sintel_00120_00012.mp4` : le nom porte les bornes, le cache se relit sans index. */
const segmentName = (film: string, start: number, duration: number): string =>
  `${film}_${String(Math.round(start)).padStart(5, '0')}_${String(Math.round(duration)).padStart(5, '0')}.mp4`;

/**
 * Un segment est-il exploitable ? Il doit porter un flux vidéo et durer ce qu'il annonce.
 *
 * Le contrôle n'est pas décoratif : un prélèvement peut « réussir » et ne contenir qu'une
 * piste de sous-titres. L'erreur ne se voit alors qu'à la version suivante, sur un message
 * qui ne nomme ni le segment ni la cause.
 */
async function assertUsable(path: string): Promise<void> {
  const probed = (await ffprobe(['-show_entries', 'stream=codec_type', '-select_streams', 'v', path])) as {
    streams?: { codec_type?: string }[];
  };
  if (!probed.streams?.some((s) => s.codec_type === 'video')) {
    throw new Error(`segment has no video stream: ${path}`);
  }
}

/** Relit le cache disque : une relance ne re-télécharge rien. */
async function loadRegistry(): Promise<void> {
  if (loaded) return;
  loaded = true;
  await ensureDir(segmentDir());
  for (const name of await readdir(segmentDir())) {
    const match = /^(.+)_(\d{5})_(\d{5})\.mp4$/.exec(name);
    if (!match) continue;
    const [, film, start, duration] = match;
    const path = join(segmentDir(), name);
    // Un segment d'une exécution antérieure peut être vide ou tronqué : il est écarté et
    // effacé, sinon la relance le réutiliserait indéfiniment.
    if (!(await isUsable(path))) {
      await rm(path, { force: true });
      continue;
    }
    const entry = { path, start: Number(start), end: Number(start) + Number(duration) };
    registry.set(film!, [...(registry.get(film!) ?? []), entry]);
  }
}

/**
 * Télécharge le master d'un film, une fois pour toutes.
 *
 * Le fichier est gros (un gigaoctet pour *Sintel*) et vit dans `dev_data/`, hors du dépôt.
 * C'est le prix d'un jeu de démonstration qui n'abuse pas d'un serveur public : une lecture
 * complète, puis plus rien.
 */
async function ensureMaster(film: keyof typeof FILMS): Promise<string> {
  const cached = masters.get(film);
  if (cached) return cached;
  const source = FILMS[film];
  if (!source) throw new Error(`unknown film: ${String(film)}`);
  const extension = source.url.split('.').pop() ?? 'mkv';
  const relative = join('masters', `${film}.${extension}`);
  const target = join(CACHE_DIR, relative);

  if (!(await exists(target))) {
    for (const [attempt, delay] of [...RETRY_DELAYS_MS, 0].entries()) {
      try {
        console.info(`  downloading master for ${film} (once)…`);
        await download(source.url, relative);
        break;
      } catch (err) {
        if (attempt >= RETRY_DELAYS_MS.length) throw err;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  masters.set(film, target);
  return target;
}

/** Version non levante de `assertUsable`, pour trier le cache existant. */
async function isUsable(path: string): Promise<boolean> {
  try {
    await assertUsable(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sérialise l'accès aux segments : **toute** la fonction, pas seulement le prélèvement.
 *
 * Sérialiser la seule extraction ne suffit pas : deux workers demandant le même segment
 * voyaient tous deux un fichier « existant » alors que le premier était encore en train de
 * l'écrire, et le second lisait un fichier sans en-tête (`moov atom not found`).
 */
async function serialise<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task);
  chain = run.catch(() => undefined);
  return run;
}

/**
 * Prélève le segment couvrant `[at, at + duration]`, ou renvoie celui du cache qui le
 * couvre déjà. Un refus du serveur (429) est réessayé avec une attente croissante.
 */
export async function ensureSegment(
  film: keyof typeof FILMS,
  at: number,
  duration: number,
): Promise<Segment> {
  return serialise(async () => {
    await loadRegistry();
    const source = FILMS[film];
    if (!source) throw new Error(`unknown film: ${String(film)}`);

    const covering = (registry.get(film) ?? []).find((s) => s.start <= at && s.end >= at + duration);
    if (covering) return covering;

    const master = await ensureMaster(film);

    const start = Math.max(0, Math.floor(at - PRE_ROLL));
    const length = Math.ceil(duration + PRE_ROLL + POST_ROLL);
    const path = join(segmentDir(), segmentName(film, start, length));
    const segment: Segment = { path, start, end: start + length };

    if (!(await exists(path))) {
      // Écriture sous `.part` puis renommage : un prélèvement interrompu ne laisse jamais
      // un fichier tronqué que la relance prendrait pour un segment valide.
      const partial = `${path}.part.mp4`;
      for (const [attempt, delay] of [...RETRY_DELAYS_MS, 0].entries()) {
        try {
          await ffmpeg([
            '-ss',
            String(start),
            '-i',
            master,
            '-t',
            String(length),
            // Le flux vidéo, et lui seul. Les masters portent des pistes de sous-titres :
            // sans cartographie explicite, un prélèvement où la vidéo manque produit un
            // fichier qui ne contient qu'un sous-titre — que tout le reste de la chaîne
            // refuse ensuite, huit versions plus loin, sans dire pourquoi.
            '-map',
            '0:v:0',
            '-an',
            '-sn',
            '-dn',
            // Les chapitres du master deviennent une piste de texte dans le MP4, que le
            // transcodage HLS propage ensuite en seconde piste — le lecteur reste alors sur
            // un écran noir sans lever la moindre erreur.
            '-map_chapters',
            '-1',
            '-map_metadata',
            '-1',
            // Prélèvement fidèle : c'est la source de toutes les versions du plan, elle ne
            // doit pas porter la perte d'un premier encodage.
            '-vf',
            'scale=1920:-2:flags=lanczos',
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '16',
            partial,
          ]);
          await assertUsable(partial);
          await rename(partial, path);
          break;
        } catch (err) {
          await rm(partial, { force: true });
          const message = (err as Error).message;
          // Un refus du serveur comme un prélèvement sans image se retentent : les deux
          // viennent de la lecture à distance, et la seconde tentative aboutit presque
          // toujours.
          const retriable =
            message.includes('429') ||
            message.includes('Too Many Requests') ||
            message.includes('no video stream');
          if (!retriable || attempt >= RETRY_DELAYS_MS.length) throw err;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    registry.set(film, [...(registry.get(film) ?? []), segment]);
    return segment;
  });
}
