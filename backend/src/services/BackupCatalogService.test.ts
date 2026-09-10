// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { config, opened } = vi.hoisted(() => ({
  config: { dir: undefined as string | undefined },
  opened: [] as string[],
}));
vi.mock('../config/env', () => ({
  env: {
    get BACKUPS_DIR() {
      return config.dir;
    },
  },
}));

vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

// Le vrai module, sous surveillance : le service importe `readFile` à son chargement, un
// `vi.spyOn` posé après coup ne verrait donc jamais rien passer — et le contrôle « n'ouvre
// que le manifeste » serait un test qui se contente de ne rien observer.
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readFile: (path: Parameters<typeof actual.readFile>[0], ...rest: unknown[]) => {
      opened.push(String(path));
      return (actual.readFile as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
    },
  };
});

import { list, parseManifest } from './BackupCatalogService';

/** Un dossier de sauvegardes tel que `scripts/backup.sh` le laisse derrière lui. */
function fixture(entries: Record<string, string | null>): string {
  const root = mkdtempSync(join(tmpdir(), 'review-backups-'));
  for (const [name, manifest] of Object.entries(entries)) {
    mkdirSync(join(root, name));
    // `db.dump` est toujours écrit : le service doit en prendre la TAILLE sans l'ouvrir.
    writeFileSync(join(root, name, 'db.dump'), 'x'.repeat(1234));
    if (manifest !== null) writeFileSync(join(root, name, 'manifest.txt'), manifest);
  }
  return root;
}

const MANIFEST = [
  'date=2026-09-10T03:00:00+02:00',
  'mode=mirror',
  'bucket=review',
  'app_version=v2.3.0',
  'db_bytes=48210993',
  'env_included=yes',
].join('\n');

afterEach(() => {
  config.dir = undefined;
  opened.length = 0;
});

describe('parseManifest', () => {
  it('lit les paires clé=valeur et ignore le reste', () => {
    expect(parseManifest('a=1\n\nbruit\nb = deux \n=vide')).toEqual({ a: '1', b: 'deux' });
  });

  it('garde une valeur qui contient un signe égal', () => {
    // `date=2026-09-10T03:00:00+02:00` n'en contient pas, mais un bucket peut en contenir.
    expect(parseManifest('bucket=a=b')).toEqual({ bucket: 'a=b' });
  });
});

describe('list', () => {
  it('dit « indisponible » quand aucun dossier n’est monté', async () => {
    // Distinct de « aucune sauvegarde » : confondre les deux ferait croire à un exploitant
    // qu'il n'en a pas, alors que l'application ne fait que ne pas les voir.
    await expect(list()).resolves.toEqual({ available: false, dir: null, entries: [] });
  });

  it('lit le manifeste et rend l’entrée, la plus récente en tête', async () => {
    config.dir = fixture({ '20260909-030000': MANIFEST, '20260910-030000': MANIFEST });
    const catalog = await list();
    expect(catalog.available).toBe(true);
    expect(catalog.entries.map((e) => e.id)).toEqual(['20260910-030000', '20260909-030000']);
    expect(catalog.entries[0]).toMatchObject({
      mode: 'mirror',
      bucket: 'review',
      fromRelease: 'v2.3.0',
      dbBytes: 48_210_993,
      envIncluded: true,
    });
  });

  it('ignore le miroir vivant et tout dossier étranger', async () => {
    // `minio-current/` EST le miroir, pas une sauvegarde — `backup.sh` ne le purge jamais
    // non plus. Un dossier sans manifeste est une sauvegarde interrompue : rien à en dire.
    config.dir = fixture({
      '20260910-030000': MANIFEST,
      'minio-current': MANIFEST,
      'notes-perso': MANIFEST,
      '20260908-030000': null,
    });
    const catalog = await list();
    expect(catalog.entries.map((e) => e.id)).toEqual(['20260910-030000']);
  });

  it('retombe sur la taille du fichier quand le manifeste est plus ancien que le champ', async () => {
    config.dir = fixture({ '20260910-030000': 'date=2026-09-10T03:00:00+02:00\nmode=mirror' });
    const { entries } = await list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.dbBytes).toBe(1234);
    expect(entries[0]?.envIncluded).toBe(false);
  });

  it('n’ouvre jamais autre chose que le manifeste', async () => {
    // Le dossier contient `env.backup` — les secrets de l'instance, écrits en 600 — et
    // `db.dump`, c'est-à-dire toute la base. Le montage est en lecture seule ; ce contrôle
    // interdit qu'on s'en serve, aujourd'hui comme au prochain ajout de champ.
    config.dir = fixture({ '20260910-030000': MANIFEST });
    writeFileSync(join(config.dir, '20260910-030000', 'env.backup'), 'JWT_SECRET=secret');
    await list();
    expect(opened.length).toBeGreaterThan(0);
    for (const path of opened) expect(path).toMatch(/manifest\.txt$/);
  });

  it('reste debout si le dossier monté est illisible', async () => {
    config.dir = join(tmpdir(), 'review-backups-inexistant-49');
    await expect(list()).resolves.toMatchObject({ available: false, entries: [] });
  });
});
