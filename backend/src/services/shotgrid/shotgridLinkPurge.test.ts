// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/logger', () => ({ logger: { warn: vi.fn() } }));

import { LOCAL_TYPES } from './shotgridLinks';

/**
 * ShotGrid links do not survive what they designate.
 *
 * `ShotgridLink` is polymorphic: no foreign key, hence no `ON DELETE CASCADE`. The guarantee rests on twelve PostgreSQL triggers, one per linkable type. The risk is that
 * a thirteenth type appears in `LOCAL_TYPES` without its trigger: the defect would be invisible — orphan links would pile up silently until a synchronization wrote to a ghost,
 * which had already happened with comments.
 *
 * This test reads the migrations and confronts the two lists. It does not replace a database check (done by hand on the docker stack, cascade included): it prevents the oversight.
 */

const MIGRATIONS = join(__dirname, '..', '..', '..', 'prisma', 'migrations');

/** Local types covered by a trigger, and the table that carries it. */
function triggeredTypes(): Map<string, string> {
  const found = new Map<string, string>();
  for (const dir of readdirSync(MIGRATIONS, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const sql = readFileSync(join(MIGRATIONS, dir.name, 'migration.sql'), 'utf8');
    const pattern =
      /CREATE TRIGGER\s+\S+\s+AFTER DELETE ON\s+"([A-Za-z]+)"\s+FOR EACH ROW\s+EXECUTE FUNCTION\s+shotgrid_link_purge\('([A-Za-z]+)'\)/g;
    for (const [, table, localType] of sql.matchAll(pattern)) found.set(localType!, table!);
  }
  return found;
}

describe('purge of ShotGrid correspondences (triggers)', () => {
  it('covers exactly the types that `LOCAL_TYPES` declares', () => {
    expect([...triggeredTypes().keys()].sort()).toEqual([...LOCAL_TYPES].sort());
  });

  it('targets the table of the corresponding model', () => {
        // A trigger set on the wrong table would erase the links of entities that are homonyms by their identifier alone: more destructive than the orphan it corrects.
    expect(Object.fromEntries(triggeredTypes())).toEqual({
      episode: 'Episode',
      sequence: 'Sequence',
      shot: 'Shot',
      asset: 'Asset',
      task: 'Task',
      version: 'Version',
      media: 'MediaObject',
      pipelineStatus: 'PipelineStatus',
      reviewStatus: 'ReviewStatus',
      user: 'User',
      playlist: 'Playlist',
      comment: 'Comment',
    });
  });

  it('cleans up the existing rows of the same types', () => {
        // The migration also corrects the past: links already orphaned at the time of the finding (10 out of 14) would not repair themselves.
    const sql = readFileSync(
      join(MIGRATIONS, '20260908090000_shotgrid_liens_fiables', 'migration.sql'),
      'utf8',
    );
    for (const localType of LOCAL_TYPES) {
      expect(sql).toContain(`l."localType" = '${localType}'`);
    }
  });
});
