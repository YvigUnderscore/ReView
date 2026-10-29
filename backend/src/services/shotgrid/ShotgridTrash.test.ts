// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, linkMap } = vi.hoisted(() => ({
  db: {
    shot: { update: vi.fn(), findUnique: vi.fn() },
    sequence: { update: vi.fn(), findUnique: vi.fn() },
    asset: { update: vi.fn(), findUnique: vi.fn() },
    task: { delete: vi.fn(), findUnique: vi.fn() },
    version: { count: vi.fn() },
  },
  linkMap: { mapSgToLocal: vi.fn(), removeLink: vi.fn() },
}));

vi.mock('../../lib/prisma', () => ({ prisma: db }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./shotgridLinks', () => ({
  mapSgToLocal: (...a: unknown[]) => linkMap.mapSgToLocal(...a),
  removeLink: (...a: unknown[]) => linkMap.removeLink(...a),
  findByLocal: vi.fn(),
  findBySg: vi.fn(),
  upsertLink: vi.fn(),
}));

import { confirmGone, trashRemoved, type PullContext } from './ShotgridPullService';

const findById = vi.fn();

const logs: Array<{ level: string; key: string }> = [];

function context(): PullContext {
  return {
    connection: { id: 1, projectId: 7 },
    client: { findById },
    journal: {
      count: vi.fn(),
      log: vi.fn(async (level: string, key: string) => {
        logs.push({ level, key });
      }),
    },
  } as unknown as PullContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  logs.length = 0;
  db.shot.update.mockResolvedValue({});
  db.task.delete.mockResolvedValue({});
  // By default the target exists: this is the common case.
  for (const t of [db.shot, db.sequence, db.asset, db.task])
    t.findUnique.mockImplementation(async (a: { where: { id: number } }) => ({ id: a.where.id }));
});

describe('trashRemoved', () => {
  it('puts into the trash what the site no longer returns', async () => {
    linkMap.mapSgToLocal.mockResolvedValue(
      new Map([
        [100, { localId: 10 }],
        [200, { localId: 20 }],
      ]),
    );

    await trashRemoved(context(), 'Shot', new Set([100]));

    // 100 is still there; 200 has left.
    expect(db.shot.update).toHaveBeenCalledTimes(1);
    expect(db.shot.update.mock.calls[0]![0].where).toEqual({ id: 20 });
    expect(db.shot.update.mock.calls[0]![0].data.deletedAt).toBeInstanceOf(Date);
  });

  it('touches nothing when everything is still there', async () => {
    linkMap.mapSgToLocal.mockResolvedValue(new Map([[100, { localId: 10 }]]));
    await trashRemoved(context(), 'Sequence', new Set([100]));
    expect(db.sequence.update).not.toHaveBeenCalled();
  });

  it('cleans up a link whose local target has disappeared', async () => {
    // Otherwise the removal — and its message — would replay at every synchronization, endlessly.
    linkMap.mapSgToLocal.mockResolvedValue(new Map([[400, { localId: 40 }]]));
    db.sequence.findUnique.mockResolvedValue(null);

    await trashRemoved(context(), 'Sequence', new Set());

    expect(linkMap.removeLink).toHaveBeenCalledWith(1, 'Sequence', 400);
    expect(db.sequence.update).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it('keeps the link of an entity put in the trash: it can come back', async () => {
    linkMap.mapSgToLocal.mockResolvedValue(new Map([[100, { localId: 10 }]]));

    await trashRemoved(context(), 'Shot', new Set());

    expect(db.shot.update).toHaveBeenCalled();
    expect(linkMap.removeLink).not.toHaveBeenCalled();
  });

  it('removes an empty task deleted on the ShotGrid side', async () => {
    linkMap.mapSgToLocal.mockResolvedValue(new Map([[300, { localId: 30 }]]));
    db.version.count.mockResolvedValue(0);

    await trashRemoved(context(), 'Task', new Set());

    expect(db.task.delete).toHaveBeenCalledWith({ where: { id: 30 } });
    expect(logs.map((l) => l.key)).toContain('shotgrid.log.trashedRemotely');
  });

  /**
   * The scope is what makes the function usable on a removal event. Without it, it could only run on a complete pass, and a `Shotgun_Shot_Retirement`
   * went through the whole chain — accepted, queued, executed — without putting anything in the trash. The journal recorded "ok", with empty statistics.
   */
  describe('restricted scope (targeted pass)', () => {
    it('only puts into the trash the identifier named by the event', async () => {
      linkMap.mapSgToLocal.mockResolvedValue(
        new Map([
          [100, { localId: 10 }],
          [200, { localId: 20 }],
        ]),
      );

      // The site has just said "200 is removed". It said nothing about 100, absent from the targeted batch for the sole reason that we did not ask for it.
      await trashRemoved(context(), 'Shot', new Set(), [200]);

      expect(db.shot.update).toHaveBeenCalledTimes(1);
      expect(db.shot.update.mock.calls[0]![0].where).toEqual({ id: 20 });
    });

    it('touches nothing when the targeted entity came back from the read', async () => {
      linkMap.mapSgToLocal.mockResolvedValue(new Map([[200, { localId: 20 }]]));

      await trashRemoved(context(), 'Shot', new Set([200]), [200]);

      expect(db.shot.update).not.toHaveBeenCalled();
    });

    it('ignores a targeted identifier that was never imported', async () => {
      linkMap.mapSgToLocal.mockResolvedValue(new Map());

      await trashRemoved(context(), 'Shot', new Set(), [999]);

      expect(db.shot.update).not.toHaveBeenCalled();
      expect(linkMap.removeLink).not.toHaveBeenCalled();
      expect(logs).toHaveLength(0);
    });
  });

  /**
   * An entity may be missing from a targeted read for two opposite reasons: the site removed it, or it still exists but belongs to another project now, and
   * `keepInProject` discarded it. Confusing the two would put a perfectly living entity elsewhere in the trash, under the message "removed in ShotGrid".
   */
  describe('confirmGone', () => {
    it('keeps what the site no longer returns at all', async () => {
      findById.mockResolvedValue(null);

      await expect(confirmGone(context(), 'Shot', [200], new Set())).resolves.toEqual([200]);
    });

    it('discards what the site still returns, even outside the project', async () => {
      // The site's answer: the entity exists. Its project is the guard's business, not the trash's.
      findById.mockResolvedValue({ id: 200, type: 'Shot' });

      await expect(confirmGone(context(), 'Shot', [200], new Set())).resolves.toEqual([]);
    });

    it('does not query the site for what the read has already returned', async () => {
      await expect(confirmGone(context(), 'Shot', [200], new Set([200]))).resolves.toEqual([]);
      expect(findById).not.toHaveBeenCalled();
    });
  });

  it('keeps a task that carries versions: deleting it would take the review with it', async () => {
    // The Prisma cascade would destroy the versions and their annotations. ShotGrid is authoritative on structure, not on the right to erase work already done.
    linkMap.mapSgToLocal.mockResolvedValue(new Map([[300, { localId: 30 }]]));
    db.version.count.mockResolvedValue(2);

    await trashRemoved(context(), 'Task', new Set());

    expect(db.task.delete).not.toHaveBeenCalled();
    expect(logs.map((l) => l.key)).toContain('shotgrid.log.trashedTaskKept');
    expect(logs.map((l) => l.key)).not.toContain('shotgrid.log.trashedRemotely');
  });
});
