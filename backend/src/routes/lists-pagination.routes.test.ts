// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * Contrat de pagination des listes qui suivent le volume du studio (plans, séquences,
 * tâches). Ce que le frontend consomme se joue ici : ce qu'on accepte en entrée
 * (`pageSize` au-delà de cent, `cursor`) et ce qu'on rend en sortie (`total`, `pageCount`,
 * `hasMore`, `nextCursor`).
 */

const { db, shots, tasks } = vi.hoisted(() => ({
  db: {
    sequence: { findMany: vi.fn(), count: vi.fn() },
    shot: { count: vi.fn() },
  },
  shots: { list: vi.fn() },
  tasks: { list: vi.fn(), listForBoard: vi.fn(), listForProject: vi.fn() },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 1, role: 'ADMIN' } as Request['user'];
    next();
  },
}));
vi.mock('../middleware/rbac', () => ({
  assertProjectAccess: vi.fn(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('./trashRoutes', () => ({ mountTrashRoutes: vi.fn() }));
vi.mock('../services/ShotService', () => shots);
vi.mock('../services/TaskService', () => tasks);
vi.mock('../services/SequenceService', () => ({ createBulk: vi.fn(), getDetail: vi.fn() }));
vi.mock('../services/PipelineLatestService', () => ({ shotOverview: vi.fn(), assetOverview: vi.fn() }));
vi.mock('../services/PipelineStatusService', () => ({ assertBelongsToProject: vi.fn() }));
vi.mock('../services/shotgrid/ShotgridGuardService', () => ({ assertLocalCreationAllowed: vi.fn() }));
vi.mock('../services/shotgrid/ShotgridPushService', () => ({ enqueuePush: vi.fn() }));
vi.mock('../lib/pipeline', () => ({
  resolveProjectIdForShot: vi.fn().mockResolvedValue(1),
  resolveProjectIdForAsset: vi.fn().mockResolvedValue(1),
  resolveProjectIdForTask: vi.fn().mockResolvedValue(1),
  resolveProjectIdForSequence: vi.fn().mockResolvedValue(1),
}));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));

import express from 'express';
import request from 'supertest';
import shotsRoutes from './shots.routes';
import sequencesRoutes from './sequences.routes';
import tasksRoutes from './tasks.routes';
import { errorHandler } from '../middleware/error';
import { encodeCursor, MAX_PAGE_SIZE } from '../lib/pagination';

const app = express()
  .use(express.json())
  .use('/api/shots', shotsRoutes)
  .use('/api/sequences', sequencesRoutes)
  .use('/api/tasks', tasksRoutes)
  .use(errorHandler);

const emptyPage = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 100,
  pageCount: 1,
  hasMore: false,
  nextCursor: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  shots.list.mockResolvedValue(emptyPage);
  tasks.list.mockResolvedValue(emptyPage);
  tasks.listForBoard.mockResolvedValue({ items: [], total: 0, truncated: false, nextCursor: null });
  tasks.listForProject.mockResolvedValue({ items: [], total: 0, truncated: false, nextCursor: null });
  db.sequence.findMany.mockResolvedValue([]);
  db.sequence.count.mockResolvedValue(0);
  db.shot.count.mockResolvedValue(0);
});

describe('GET /api/shots — plafond et curseur', () => {
  it('accepte enfin plus de cent lignes par page', async () => {
    // Le plafond ÉTAIT le défaut : demander 200 plans était impossible, et le frontend
    // ne demandait jamais la page 2 — 1 900 plans sur 2 000 étaient hors d'atteinte.
    const res = await request(app).get('/api/shots?projectId=1&pageSize=200');
    expect(res.status).toBe(200);
    expect(shots.list).toHaveBeenCalledWith(
      1,
      undefined,
      expect.objectContaining({ pageSize: 200 }),
      undefined,
    );
  });

  it('refuse au-delà du plafond dur', async () => {
    const res = await request(app).get(`/api/shots?projectId=1&pageSize=${MAX_PAGE_SIZE + 1}`);
    expect(res.status).toBe(400);
  });

  it('transmet le curseur au service', async () => {
    const cursor = encodeCursor(0, 812);
    await request(app).get(`/api/shots?projectId=1&cursor=${encodeURIComponent(cursor)}`);
    expect(shots.list).toHaveBeenCalledWith(1, undefined, expect.objectContaining({ cursor }), undefined);
  });

  it('garde le filtre de séquence, « none » compris', async () => {
    await request(app).get('/api/shots?projectId=1&sequenceId=none&page=2');
    expect(shots.list).toHaveBeenCalledWith(1, 'none', expect.objectContaining({ page: 2 }), undefined);
  });

  it('transmet le filtre d’épisode, « none » compris', async () => {
    // Express 5 rend `req.query` en lecture seule : la valeur coercée par Zod ne réécrit
    // pas la chaîne d'origine, exactement comme pour `sequenceId`. Le service normalise
    // avec `Number()` — c'est vérifié dans `ShotService.episode.test.ts`.
    await request(app).get('/api/shots?projectId=1&episodeId=4');
    expect(shots.list).toHaveBeenCalledWith(1, undefined, expect.anything(), '4');
    await request(app).get('/api/shots?projectId=1&episodeId=none');
    expect(shots.list).toHaveBeenCalledWith(1, undefined, expect.anything(), 'none');
  });

  it('refuse un épisode qui n’est ni un entier ni « none »', async () => {
    expect((await request(app).get('/api/shots?projectId=1&episodeId=EP1')).status).toBe(400);
  });
});

describe('GET /api/sequences — liste bornée', () => {
  it('garde la forme historique et y ajoute de quoi savoir ce qui manque', async () => {
    db.sequence.findMany.mockResolvedValue([{ id: 1, code: 'SQ01', _count: { shots: 12 } }]);
    db.sequence.count.mockResolvedValue(640);
    db.shot.count.mockResolvedValue(4);
    const res = await request(app).get('/api/sequences?projectId=1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      sequences: [{ id: 1, code: 'SQ01' }],
      unsequencedShots: 4,
      total: 640,
      page: 1,
      pageSize: MAX_PAGE_SIZE,
      hasMore: true,
    });
  });

  it('borne la requête et départage le tri par id', async () => {
    await request(app).get('/api/sequences?projectId=1');
    expect(db.sequence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: MAX_PAGE_SIZE,
        skip: 0,
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('laisse lire la suite', async () => {
    await request(app).get('/api/sequences?projectId=1&page=2&pageSize=50');
    expect(db.sequence.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 50, take: 50 }));
  });
});

describe('GET /api/tasks — page, projet et board', () => {
  it('sert la liste d’un plan avec l’enveloppe standard', async () => {
    const res = await request(app).get('/api/tasks?shotId=9&pageSize=250');
    expect(res.status).toBe(200);
    expect(tasks.list).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 250 }), 9, undefined);
  });

  it('sert les destinations d’upload avec une page large par défaut', async () => {
    // Le comportement d'avant (500 tâches d'un bloc) est conservé ; ce qui change, c'est
    // que la réponse dit désormais combien il y en a et où reprendre.
    const res = await request(app).get('/api/tasks?projectId=1');
    expect(tasks.listForProject).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ pageSize: MAX_PAGE_SIZE }),
    );
    expect(res.body).toMatchObject({ tasks: [], total: 0, truncated: false, nextCursor: null });
  });

  it('passe le curseur du board', async () => {
    const cursor = encodeCursor(0, 55);
    await request(app).get(`/api/tasks/board?projectId=1&limit=500&cursor=${encodeURIComponent(cursor)}`);
    expect(tasks.listForBoard).toHaveBeenCalledWith(1, 500, cursor);
  });

  it('sans curseur, le board se comporte comme avant', async () => {
    await request(app).get('/api/tasks/board?projectId=1');
    expect(tasks.listForBoard).toHaveBeenCalledWith(1, undefined, undefined);
  });
});
