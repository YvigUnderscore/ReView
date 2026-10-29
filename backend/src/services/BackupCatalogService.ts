// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../config/env';
import { logger } from '../lib/logger';

/**
 * Catalogue of backups taken by `scripts/backup.sh`.
 *
 * ⚠ This service **only opens `manifest.txt`**, and that is a security decision, not a saving. The backup
 * folder contains `env.backup`, a copy of the instance secrets written with mode 600, and `db.dump`, that is,
 * the whole database. The mount is therefore read-only and this module never reads anything but the manifest,
 * whose content is what `backup.sh` writes itself (six `key=value` lines). The size of the dump is obtained
 * with `stat`, never by reading it.
 *
 * Missing `BACKUPS_DIR`: the catalogue answers "unavailable" and the screen explains it. An empty list and an
 * invisible folder are not the same thing, and confusing them would make an operator believe they have no
 * backups.
 */

/** A backup folder, named after the moment it started. */
export interface BackupEntry {
  /** `YYYYMMDD-HHMMSS` timestamp: this is the folder name, and the identifier everywhere. */
  id: string;
  /** ISO date declared by the manifest; otherwise that of the folder. */
  date: string | null;
  mode: string | null;
  bucket: string | null;
  /** Application version at backup time (`app_version` of the manifest). */
  fromRelease: string | null;
  dbBytes: number | null;
  /** Do the secrets come along? Without them, a restore elsewhere yields unreadable rows. */
  envIncluded: boolean;
  /**
   * The exact command to restore THIS backup. Composed here, never on screen: a shell line belongs to the
   * module that knows the scripts, and text assembled in a component would escape the hard-coded string
   * check.
   */
  restoreCommand: string;
}

export interface BackupCatalog {
  /** `false` when no folder is mounted: the screen says so instead of displaying "none". */
  available: boolean;
  dir: string | null;
  entries: BackupEntry[];
}

/** Name of a backup folder: `backup.sh` composes it with `date +%Y%m%d-%H%M%S`. */
export const BACKUP_STAMP = /^\d{8}-\d{6}$/;

/** A manifest has six lines; beyond that, it is not a manifest. */
const MAX_MANIFEST_BYTES = 8 * 1024;
/** What the screen shows: beyond this, one no longer scrolls, one searches in a terminal. */
const MAX_ENTRIES = 50;

/** `key=value` per line: the format `backup.sh` writes, nothing more. */
export function parseManifest(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/** Reads an entry; a folder without a readable manifest is skipped, not reported as an error. */
async function readEntry(dir: string, id: string): Promise<BackupEntry | null> {
  const path = join(dir, id);
  let manifest: Record<string, string>;
  try {
    const info = await stat(join(path, 'manifest.txt'));
    if (!info.isFile() || info.size > MAX_MANIFEST_BYTES) return null;
    manifest = parseManifest(await readFile(join(path, 'manifest.txt'), 'utf8'));
  } catch {
    // Interrupted backup, foreign folder, permissions: nothing reliable to report about it.
    return null;
  }

  let dbBytes: number | null = Number.parseInt(manifest.db_bytes ?? '', 10);
  if (Number.isNaN(dbBytes)) {
    // Manifest older than the field: the size is taken from the file, without opening it.
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

/** Available backups, most recent first. */
export async function list(): Promise<BackupCatalog> {
  const dir = env.BACKUPS_DIR;
  if (!dir) return { available: false, dir: null, entries: [] };

  let names: string[];
  try {
    names = (await readdir(dir, { withFileTypes: true }))
      // `minio-current/` is the live mirror, not a backup: excluding it here is the same rule as
      // `backup.sh`'s rotation, which never purges it either.
      .filter((e) => e.isDirectory() && BACKUP_STAMP.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse()
      .slice(0, MAX_ENTRIES);
  } catch (err) {
    logger.warn({ err, dir }, '[Backups] unreadable folder');
    return { available: false, dir, entries: [] };
  }

  const entries = (await Promise.all(names.map((name) => readEntry(dir, name)))).filter(
    (entry): entry is BackupEntry => entry !== null,
  );
  return { available: true, dir, entries };
}
