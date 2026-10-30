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

// The real module, under surveillance: the service imports `readFile` at load time, so a `vi.spyOn`
// installed afterwards would never see anything pass, and the "only opens the manifest" check would be a
// test that merely observes nothing.
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

/** A backup folder as `scripts/backup.sh` leaves it behind. */
function fixture(entries: Record<string, string | null>): string {
  const root = mkdtempSync(join(tmpdir(), 'review-backups-'));
  for (const [name, manifest] of Object.entries(entries)) {
    mkdirSync(join(root, name));
    // `db.dump` is always written: the service must take its SIZE without opening it.
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
  it('reads key=value pairs and ignores the rest', () => {
    expect(parseManifest('a=1\n\nbruit\nb = deux \n=vide')).toEqual({ a: '1', b: 'deux' });
  });

  it('keeps a value that contains an equals sign', () => {
    // `date=2026-09-10T03:00:00+02:00` contains none, but a bucket may.
    expect(parseManifest('bucket=a=b')).toEqual({ bucket: 'a=b' });
  });
});

describe('list', () => {
  it('says "unavailable" when no folder is mounted', async () => {
    // Distinct from "no backups": confusing the two would make an operator believe they have none, when the
    // application merely cannot see them.
    await expect(list()).resolves.toEqual({ available: false, dir: null, entries: [] });
  });

  it('reads the manifest and returns the entry, most recent first', async () => {
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
      restoreCommand: 'bash scripts/restore.sh all backups/20260910-030000',
    });
  });

  it('ignores the live mirror and any foreign folder', async () => {
    // `minio-current/` IS the mirror, not a backup: `backup.sh` never purges it either. A folder without a
    // manifest is an interrupted backup: there is nothing to report about it.
    config.dir = fixture({
      '20260910-030000': MANIFEST,
      'minio-current': MANIFEST,
      'notes-perso': MANIFEST,
      '20260908-030000': null,
    });
    const catalog = await list();
    expect(catalog.entries.map((e) => e.id)).toEqual(['20260910-030000']);
  });

  it('falls back to the file size when the manifest is older than the field', async () => {
    config.dir = fixture({ '20260910-030000': 'date=2026-09-10T03:00:00+02:00\nmode=mirror' });
    const { entries } = await list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.dbBytes).toBe(1234);
    expect(entries[0]?.envIncluded).toBe(false);
  });

  it('never opens anything but the manifest', async () => {
    // The folder contains `env.backup` (the instance secrets, written 600) and `db.dump`, that is the whole
    // database. The mount is read-only; this check forbids using them, today and with the next added field.
    config.dir = fixture({ '20260910-030000': MANIFEST });
    writeFileSync(join(config.dir, '20260910-030000', 'env.backup'), 'JWT_SECRET=secret');
    await list();
    expect(opened.length).toBeGreaterThan(0);
    for (const path of opened) expect(path).toMatch(/manifest\.txt$/);
  });

  it('stays up if the mounted folder is unreadable', async () => {
    config.dir = join(tmpdir(), 'review-backups-inexistant-49');
    await expect(list()).resolves.toMatchObject({ available: false, entries: [] });
  });
});
