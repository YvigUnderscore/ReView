// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    version: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    shot: { findFirst: vi.fn() },
    asset: { findFirst: vi.fn() },
    project: { findUnique: vi.fn() },
    department: { findMany: vi.fn() },
  },
}));
vi.mock('./StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn(async (k: string) => `https://minio/${k}`) },
}));

import { latestForShots, latestForAssets } from './PipelineLatestService';
import { prisma } from '../lib/prisma';
import type { Department } from '../lib/projectSettings';

const findMany = vi.mocked(prisma.version.findMany);

/** Pipe du projet, de l'amont vers l'aval. */
const PIPE: Department[] = [
  { key: 'layout', name: 'Layout' },
  { key: 'anim', name: 'Animation' },
  { key: 'comp', name: 'Compositing' },
];

/** Une ligne de la passe d'élection : rattachement, étape, date, identifiant. */
const candidate = (
  id: number,
  createdAt: string,
  task: { department: string | null; shotId?: number | null; assetId?: number | null } | null,
  assetId: number | null = null,
) => ({
  id,
  createdAt: new Date(createdAt),
  assetId,
  task: task
    ? { department: task.department, shotId: task.shotId ?? null, assetId: task.assetId ?? null }
    : null,
});

/** Une ligne de la passe de contenu : ce que le lecteur reçoit vraiment. */
const payload = (id: number, name: string) => ({
  id,
  name,
  status: 'PUBLISHED',
  createdAt: new Date('2026-08-01T00:00:00Z'),
  assetId: null,
  author: null,
  reviewStatus: null,
  task: { id: 1, name: 'comp', department: 'comp', type: 'OTHER', shotId: 1, assetId: null },
  media: [],
});

/** Passe 1 (élection) puis passe 2 (contenu des élus). */
function stubTwoPhases(candidates: unknown[], payloads: unknown[]) {
  findMany.mockResolvedValueOnce(candidates as never).mockResolvedValueOnce(payloads as never);
}

describe('PipelineLatestService — élection en deux passes', () => {
  // `resetAllMocks` et non `clearAllMocks` : les réponses posées par `mockResolvedValueOnce`
  // survivraient sinon d'un test à l'autre et décaleraient les passes.
  beforeEach(() => vi.resetAllMocks());

  it('ne touche pas la base sans entité à résoudre', async () => {
    expect(await latestForShots([], PIPE)).toEqual(new Map());
    expect(await latestForAssets([], PIPE)).toEqual(new Map());
    expect(findMany).not.toHaveBeenCalled();
  });

  it('n’élit qu’une version par plan, et ne charge le contenu que des élues', async () => {
    stubTwoPhases(
      [
        // Plan 1 : le compositing est plus avancé que l'animation, même publiée après.
        candidate(10, '2026-08-01T00:00:00Z', { department: 'anim', shotId: 1 }),
        candidate(11, '2026-08-02T00:00:00Z', { department: 'comp', shotId: 1 }),
        candidate(12, '2026-08-05T00:00:00Z', { department: 'anim', shotId: 1 }),
        // Plan 2 : une seule étape, la plus récente gagne.
        candidate(20, '2026-08-01T00:00:00Z', { department: 'anim', shotId: 2 }),
        candidate(21, '2026-08-03T00:00:00Z', { department: 'anim', shotId: 2 }),
      ],
      [payload(11, 'V02'), payload(21, 'V03')],
    );

    const picks = await latestForShots([1, 2], PIPE);

    expect([...picks.keys()]).toEqual([1, 2]);
    expect(picks.get(1)!.versionId).toBe(11);
    expect(picks.get(2)!.versionId).toBe(21);
    // Passe 2 : uniquement les deux élues, jamais les cinq prétendantes.
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[1]![0]!.where).toEqual({ id: { in: [11, 21] } });
  });

  it('n’embarque ni médias ni auteur dans la passe d’élection', async () => {
    stubTwoPhases([], []);
    await latestForShots([1], PIPE);
    const select = findMany.mock.calls[0]![0]!.select as Record<string, unknown>;
    expect(Object.keys(select).sort()).toEqual(['assetId', 'createdAt', 'id', 'task']);
    expect(select.media).toBeUndefined();
    // La passe 2, elle, ramène bien les médias visibles.
    expect(findMany).toHaveBeenCalledTimes(1); // aucune élue : pas de seconde passe
  });

  it('ne demande que les versions publiées porteuses d’un média visible', async () => {
    stubTwoPhases([], []);
    await latestForShots([1, 2], PIPE);
    expect(findMany.mock.calls[0]![0]!.where).toMatchObject({
      deletedAt: null,
      published: true,
      task: { shotId: { in: [1, 2] } },
    });
  });

  it('plafonne à l’étape demandée, et retombe sur l’amont quand elle manque', async () => {
    stubTwoPhases(
      [
        candidate(10, '2026-08-01T00:00:00Z', { department: 'anim', shotId: 1 }),
        candidate(11, '2026-08-02T00:00:00Z', { department: 'comp', shotId: 1 }),
        // Plan 2 : rien en anim, seulement du layout — le repli amont doit jouer.
        candidate(20, '2026-08-01T00:00:00Z', { department: 'layout', shotId: 2 }),
      ],
      [payload(10, 'V01'), payload(20, 'V01')],
    );
    const picks = await latestForShots([1, 2], PIPE, 'anim');
    expect(picks.get(1)!.versionId).toBe(10);
    expect(picks.get(2)!.versionId).toBe(20);
  });

  it('résout un asset par sa tâche comme par sa version directe', async () => {
    stubTwoPhases(
      [
        candidate(30, '2026-08-01T00:00:00Z', { department: 'comp', assetId: 5 }),
        // Version accrochée directement à l'asset 6, sans tâche : hors pipe, elle gagne
        // faute d'autre prétendante.
        candidate(31, '2026-08-02T00:00:00Z', null, 6),
      ],
      [payload(30, 'V01'), payload(31, 'V01')],
    );
    const picks = await latestForAssets([5, 6], PIPE);
    expect(picks.get(5)!.versionId).toBe(30);
    expect(picks.get(6)!.versionId).toBe(31);
  });

  it('ignore une entité dont aucune version n’a survécu au chargement', async () => {
    // Une version supprimée entre les deux passes ne doit pas produire d'entrée vide.
    stubTwoPhases([candidate(40, '2026-08-01T00:00:00Z', { department: 'comp', shotId: 9 })], []);
    expect(await latestForShots([9], PIPE)).toEqual(new Map());
  });
});
