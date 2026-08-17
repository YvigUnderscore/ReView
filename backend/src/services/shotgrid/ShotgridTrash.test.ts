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

import { trashRemoved, type PullContext } from './ShotgridPullService';

const logs: Array<{ level: string; key: string }> = [];

function context(): PullContext {
  return {
    connection: { id: 1, projectId: 7 },
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
  // Par défaut la cible existe : c'est le cas courant.
  for (const t of [db.shot, db.sequence, db.asset, db.task])
    t.findUnique.mockImplementation(async (a: { where: { id: number } }) => ({ id: a.where.id }));
});

describe('trashRemoved', () => {
  it('met à la corbeille ce que le site ne renvoie plus', async () => {
    linkMap.mapSgToLocal.mockResolvedValue(
      new Map([
        [100, { localId: 10 }],
        [200, { localId: 20 }],
      ]),
    );

    await trashRemoved(context(), 'Shot', new Set([100]));

    // 100 est toujours là-bas ; 200 en est parti.
    expect(db.shot.update).toHaveBeenCalledTimes(1);
    expect(db.shot.update.mock.calls[0]![0].where).toEqual({ id: 20 });
    expect(db.shot.update.mock.calls[0]![0].data.deletedAt).toBeInstanceOf(Date);
  });

  it('ne touche à rien quand tout est encore là', async () => {
    linkMap.mapSgToLocal.mockResolvedValue(new Map([[100, { localId: 10 }]]));
    await trashRemoved(context(), 'Sequence', new Set([100]));
    expect(db.sequence.update).not.toHaveBeenCalled();
  });

  it('nettoie un lien dont la cible locale a disparu', async () => {
    // Sinon le retrait — et son message — rejouent à chaque synchronisation, sans fin.
    linkMap.mapSgToLocal.mockResolvedValue(new Map([[400, { localId: 40 }]]));
    db.sequence.findUnique.mockResolvedValue(null);

    await trashRemoved(context(), 'Sequence', new Set());

    expect(linkMap.removeLink).toHaveBeenCalledWith(1, 'Sequence', 400);
    expect(db.sequence.update).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it('garde le lien d’une entité mise à la corbeille : elle peut revenir', async () => {
    linkMap.mapSgToLocal.mockResolvedValue(new Map([[100, { localId: 10 }]]));

    await trashRemoved(context(), 'Shot', new Set());

    expect(db.shot.update).toHaveBeenCalled();
    expect(linkMap.removeLink).not.toHaveBeenCalled();
  });

  it('retire une tâche vide supprimée côté ShotGrid', async () => {
    linkMap.mapSgToLocal.mockResolvedValue(new Map([[300, { localId: 30 }]]));
    db.version.count.mockResolvedValue(0);

    await trashRemoved(context(), 'Task', new Set());

    expect(db.task.delete).toHaveBeenCalledWith({ where: { id: 30 } });
    expect(logs.map((l) => l.key)).toContain('shotgrid.log.trashedRemotely');
  });

  it('garde une tâche qui porte des versions : la supprimer emporterait la review', async () => {
    // La cascade Prisma détruirait les versions et leurs annotations. ShotGrid fait foi
    // sur la structure, pas sur le droit d'effacer du travail déjà fait.
    linkMap.mapSgToLocal.mockResolvedValue(new Map([[300, { localId: 30 }]]));
    db.version.count.mockResolvedValue(2);

    await trashRemoved(context(), 'Task', new Set());

    expect(db.task.delete).not.toHaveBeenCalled();
    expect(logs.map((l) => l.key)).toContain('shotgrid.log.trashedTaskKept');
    expect(logs.map((l) => l.key)).not.toContain('shotgrid.log.trashedRemotely');
  });
});
