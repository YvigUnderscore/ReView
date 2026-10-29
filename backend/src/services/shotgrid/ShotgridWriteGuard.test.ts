// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Nobody writes to ShotGrid outside `ShotgridWriter`.
 *
 * The partitioning guards existed before this test, and they were correct. What was missing was for them to be **mandatory**: nothing prevented a new call from talking to the client
 * directly, and the history of the file shows it slips — `ShotgridPlaylistSync` had copied the three checks by hand instead of reusing the common path, and a copy always ends up diverging from the original.
 *
 * The check is deliberately dumb and textual: it looks for the client's `unsafe*` methods throughout the backend. A write added anywhere other than here makes the suite fail
 * before it reaches a production site. It is the same idiom as `shotgridLinkPurge.test.ts`, which confronts the list of linked types with the SQL triggers.
 */

/** The client's raw write methods — their name already says that they are not to be called. */
const UNSAFE_METHODS = ['unsafeCreate', 'unsafeUpdate', 'unsafeRemove', 'unsafeUploadFile'];

/**
 * The only files entitled to name them: the client that declares them, the writer that calls them, and the two suites that test them. A test reaches no production site —
 * but the list stays nominative, so that exempting a file is a visible gesture in the diff rather than a side effect of an overly broad rule.
 */
const ALLOWED = [
  'services/shotgrid/ShotgridClient.ts',
  'services/shotgrid/ShotgridWriter.ts',
  'services/shotgrid/ShotgridClient.test.ts',
  'services/shotgrid/ShotgridWriter.test.ts',
];

const SRC = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Path relative to `src`, in POSIX separators — readable in the failure message. */
const relative = (file: string) =>
  file
    .slice(SRC.length + 1)
    .split('\\')
    .join('/');

describe('ShotGrid writes', () => {
  it('only leave from ShotgridWriter', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const rel = relative(file);
      if (ALLOWED.includes(rel)) continue;
      // This file necessarily cites the names it forbids.
      if (rel.endsWith('ShotgridWriteGuard.test.ts')) continue;

      const source = readFileSync(file, 'utf8');
      for (const method of UNSAFE_METHODS) {
        if (source.includes(method)) offenders.push(`${rel} → ${method}`);
      }
    }

    expect(
      offenders,
      `Écriture ShotGrid hors de ShotgridWriter :\n  ${offenders.join('\n  ')}\n` +
        'Passer par ctx.writer — il pose le projet lié, relit la cible et refuse les projets modèles.',
    ).toEqual([]);
  });

  it('keeps the list of raw methods aligned with the client', () => {
    // If a write method is added to the client without being listed here, it would slip past the check above without anyone noticing.
    const client = readFileSync(join(SRC, 'services/shotgrid/ShotgridClient.ts'), 'utf8');
    const declared = Array.from(client.matchAll(/async (unsafe[A-Za-z]+)\(/g), (m) => m[1]);

    expect(declared.sort()).toEqual([...UNSAFE_METHODS].sort());
  });
});
