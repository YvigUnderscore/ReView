// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { CACHE_DIR } from '../config';

const execFileAsync = promisify(execFile);

/** Le fichier existe-t-il déjà (et n'est-il pas vide) ? */
export async function exists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.size > 0;
  } catch {
    return false;
  }
}

/**
 * Le fichier existe-t-il **et pèse-t-il ce qu'un fichier valide pèse** ?
 *
 * Un encodage interrompu, ou une source qui n'a pas livré d'image, laisse un fichier de
 * quelques centaines d'octets. Il existe, il n'est pas vide, et la relance le prend pour un
 * livrable déjà produit — l'erreur ne se voit alors qu'au dépôt, où le contrôle d'en-tête
 * le refuse sans dire d'où il vient.
 */
export async function existsWithMinSize(path: string, minBytes: number): Promise<boolean> {
  try {
    return (await stat(path)).size >= minBytes;
  } catch {
    return false;
  }
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

/**
 * Télécharge une URL dans le cache et renvoie le chemin local.
 *
 * Écriture d'abord sous `.part` puis renommage : un téléchargement interrompu ne laisse
 * jamais un fichier tronqué que la relance prendrait pour un cache valide.
 */
export async function download(url: string, relPath: string): Promise<string> {
  const target = join(CACHE_DIR, relPath);
  if (await exists(target)) return target;
  await ensureDir(dirname(target));
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} on ${url}`);
  const tmp = `${target}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  await rename(tmp, target);
  return target;
}

/** Télécharge un JSON (sans cache disque : ce sont des index, pas des médias). */
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return (await res.json()) as T;
}

/** Écrit un fichier texte en créant son dossier. */
export async function writeText(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, content, 'utf8');
}

/**
 * Lance ffmpeg en silence ; l'échec remonte avec la fin de stderr, seule partie utile.
 *
 * `cwd` compte : le filtre `drawtext` refuse un chemin de police absolu sous Windows (le
 * `:` du lecteur y sépare deux options de filtre), on l'appelle donc depuis le dossier qui
 * contient la police, avec un chemin relatif.
 */
export async function ffmpeg(args: string[], cwd?: string): Promise<void> {
  try {
    await execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      ...(cwd ? { cwd } : {}),
    });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? String(err);
    throw new Error(`ffmpeg failed: ${stderr.split('\n').slice(-6).join('\n')}`, { cause: err });
  }
}

/** Interroge ffprobe et renvoie le JSON demandé. */
export async function ffprobe(args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-print_format', 'json', ...args], {
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  return JSON.parse(stdout);
}
