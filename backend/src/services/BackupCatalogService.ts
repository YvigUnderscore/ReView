// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../config/env';
import { logger } from '../lib/logger';

/**
 * Le catalogue des sauvegardes prises par `scripts/backup.sh`.
 *
 * ⚠ Ce service **n'ouvre que `manifest.txt`**, et c'est une décision de sécurité, pas une
 * économie. Le dossier de sauvegarde contient `env.backup` — une copie des secrets de
 * l'instance, écrite en 600 — et `db.dump`, c'est-à-dire toute la base. Le montage est
 * donc en lecture seule et ce module ne lit jamais autre chose que le manifeste, dont le
 * contenu est celui que `backup.sh` écrit lui-même (six lignes `clé=valeur`). La taille
 * du dump est obtenue par `stat`, jamais en le lisant.
 *
 * Absence de `BACKUPS_DIR` : le catalogue répond « indisponible » et l'écran l'explique.
 * Une liste vide et un dossier invisible ne sont pas la même chose, et les confondre
 * ferait croire à un exploitant qu'il n'a aucune sauvegarde.
 */

/** Un dossier de sauvegarde, nommé par l'instant où il a commencé. */
export interface BackupEntry {
  /** Horodatage `AAAAMMJJ-HHMMSS` — c'est le nom du dossier, et l'identifiant partout. */
  id: string;
  /** Date ISO déclarée par le manifeste ; à défaut, celle du dossier. */
  date: string | null;
  mode: string | null;
  bucket: string | null;
  /** Version de l'application au moment de la sauvegarde (`app_version` du manifeste). */
  fromRelease: string | null;
  dbBytes: number | null;
  /** Les secrets suivent-ils ? Sans eux, une restauration ailleurs rend des lignes illisibles. */
  envIncluded: boolean;
  /**
   * La commande exacte pour restaurer CETTE sauvegarde. Composée ici, jamais à l'écran :
   * une ligne de shell appartient au module qui connaît les scripts, et un texte fabriqué
   * dans un composant échapperait au contrôle des chaînes en dur.
   */
  restoreCommand: string;
}

export interface BackupCatalog {
  /** `false` quand aucun dossier n'est monté : l'écran le dit au lieu d'afficher « aucune ». */
  available: boolean;
  dir: string | null;
  entries: BackupEntry[];
}

/** Nom d'un dossier de sauvegarde — `backup.sh` le compose avec `date +%Y%m%d-%H%M%S`. */
export const BACKUP_STAMP = /^\d{8}-\d{6}$/;

/** Un manifeste fait six lignes ; au-delà, ce n'est pas un manifeste. */
const MAX_MANIFEST_BYTES = 8 * 1024;
/** Ce que l'écran montre : au-delà, on ne défile plus, on cherche dans un terminal. */
const MAX_ENTRIES = 50;

/** `clé=valeur` par ligne — le format qu'écrit `backup.sh`, rien de plus. */
export function parseManifest(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/** Lit une entrée ; un dossier sans manifeste lisible est ignoré, pas signalé en erreur. */
async function readEntry(dir: string, id: string): Promise<BackupEntry | null> {
  const path = join(dir, id);
  let manifest: Record<string, string>;
  try {
    const info = await stat(join(path, 'manifest.txt'));
    if (!info.isFile() || info.size > MAX_MANIFEST_BYTES) return null;
    manifest = parseManifest(await readFile(join(path, 'manifest.txt'), 'utf8'));
  } catch {
    // Sauvegarde interrompue, dossier étranger, permissions : rien à en dire de fiable.
    return null;
  }

  let dbBytes: number | null = Number.parseInt(manifest.db_bytes ?? '', 10);
  if (Number.isNaN(dbBytes)) {
    // Manifeste plus ancien que le champ : la taille se prend sur le fichier, sans l'ouvrir.
    dbBytes = await stat(join(path, 'db.dump'))
      .then((s) => s.size)
      .catch(() => null);
  }

  return {
    id,
    date: manifest.date ?? null,
    mode: manifest.mode ?? null,
    bucket: manifest.bucket ?? null,
    fromRelease: manifest.app_version || null,
    dbBytes,
    envIncluded: manifest.env_included === 'yes',
    restoreCommand: `bash scripts/restore.sh all backups/${id}`,
  };
}

/** Les sauvegardes présentes, la plus récente en tête. */
export async function list(): Promise<BackupCatalog> {
  const dir = env.BACKUPS_DIR;
  if (!dir) return { available: false, dir: null, entries: [] };

  let names: string[];
  try {
    names = (await readdir(dir, { withFileTypes: true }))
      // `minio-current/` est le miroir vivant, pas une sauvegarde : l'exclure ici est la
      // même règle que la rotation de `backup.sh`, qui ne le purge jamais non plus.
      .filter((e) => e.isDirectory() && BACKUP_STAMP.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse()
      .slice(0, MAX_ENTRIES);
  } catch (err) {
    logger.warn({ err, dir }, '[Backups] dossier illisible');
    return { available: false, dir, entries: [] };
  }

  const entries = (await Promise.all(names.map((name) => readEntry(dir, name)))).filter(
    (entry): entry is BackupEntry => entry !== null,
  );
  return { available: true, dir, entries };
}
