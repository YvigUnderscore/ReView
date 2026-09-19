// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * PERF-06 — contrat de la fenêtre du planning. La route ne prenait aucun paramètre : le
 * client ne pouvait pas demander moins que tout le projet. Elle accepte désormais deux
 * bornes facultatives, et les transmet telles quelles au service.
 */

vi.mock('../services/ScheduleService', () => ({
  getProjectSchedule: vi.fn(() => Promise.resolve({ tasks: [], truncated: false, limit: 2000 })),
}));
vi.mock('../services/StatsService', () => ({ getProjectStats: vi.fn() }));
vi.mock('../services/ProductionService', () => ({ getOverview: vi.fn() }));
vi.mock('../services/GridService', () => ({
  getProjectGrid: vi.fn(() => Promise.resolve({})),
  GRID_MAX_LIMIT: 200,
}));
vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 7, role: 'ADMIN' } as Request['user'];
    next();
  },
}));
/**
 * La garde est celle de la GESTION de projet, plus celle du simple membership : l'onglet
 * expose la charge nominative, les retards et les tâches non assignées. Le test la remplace
 * par un interrupteur pour vérifier les deux issues sans monter le RBAC entier.
 */
let manageAllowed = true;
vi.mock('../middleware/rbac', () => ({
  requireProjectManage: (_req: Request, res: Response, next: NextFunction) => {
    if (manageAllowed) return next();
    res.status(403).json({ error: 'Managing the project is reserved to supervisors' });
  },
}));

import express from 'express';
import request from 'supertest';
import productionRoutes from './production.routes';
import * as ScheduleService from '../services/ScheduleService';
import * as GridService from '../services/GridService';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/projects', productionRoutes).use(errorHandler);
const getSchedule = vi.mocked(ScheduleService.getProjectSchedule);

beforeEach(() => {
  vi.clearAllMocks();
  manageAllowed = true;
});

describe('GET /api/projects/:projectId/schedule', () => {
  it('sans borne, demande le planning entier — le contrat d’avant est intact', async () => {
    const res = await request(app).get('/api/projects/7/schedule');
    expect(res.status).toBe(200);
    expect(getSchedule).toHaveBeenCalledWith(7, { from: undefined, to: undefined });
  });

  it('transmet la fenêtre demandée, convertie en dates', async () => {
    const res = await request(app).get('/api/projects/7/schedule?from=2026-09-01&to=2026-12-01');
    expect(res.status).toBe(200);
    expect(getSchedule).toHaveBeenCalledWith(7, {
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-12-01T00:00:00.000Z'),
    });
  });

  it('accepte une borne seule', async () => {
    await request(app).get('/api/projects/7/schedule?from=2026-09-01');
    expect(getSchedule).toHaveBeenCalledWith(7, {
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: undefined,
    });
  });

  it('refuse une borne illisible plutôt que de l’ignorer', async () => {
    const res = await request(app).get('/api/projects/7/schedule?to=la-semaine-prochaine');
    expect(res.status).toBe(400);
    expect(getSchedule).not.toHaveBeenCalled();
  });

  it('rend le plafond et l’état de troncature au lecteur', async () => {
    getSchedule.mockResolvedValue({ tasks: [], truncated: true, limit: 2000 });
    const res = await request(app).get('/api/projects/7/schedule');
    expect(res.body).toEqual({ tasks: [], truncated: true, limit: 2000 });
  });
});

describe('GET /api/projects/:projectId/grid', () => {
  it('sert la page par défaut sans aucun filtre', async () => {
    const res = await request(app).get('/api/projects/7/grid');
    expect(res.status).toBe(200);
    expect(vi.mocked(GridService.getProjectGrid)).toHaveBeenCalledWith(7, {});
  });

  it('transmet curseur, plafond et les cinq filtres, convertis en nombres', async () => {
    await request(app).get(
      '/api/projects/7/grid?cursor=abc&limit=120&episodeId=5&sequenceId=3&department=comp&assigneeId=9&status=ip',
    );
    expect(vi.mocked(GridService.getProjectGrid)).toHaveBeenCalledWith(7, {
      cursor: 'abc',
      limit: 120,
      episodeId: 5,
      sequenceId: 3,
      department: 'comp',
      assigneeId: 9,
      status: 'ip',
    });
  });

  it('refuse un plafond hors bornes plutôt que de le rogner en silence', async () => {
    const res = await request(app).get('/api/projects/7/grid?limit=5000');
    expect(res.status).toBe(400);
    expect(vi.mocked(GridService.getProjectGrid)).not.toHaveBeenCalled();
  });

  it('refuse un identifiant de séquence illisible', async () => {
    expect((await request(app).get('/api/projects/7/grid?sequenceId=abc')).status).toBe(400);
  });
});

describe('Production — droits de lecture', () => {
  /** Les quatre lectures de l'onglet, toutes réservées à qui gère le projet. */
  const paths = [
    '/api/projects/7/grid',
    '/api/projects/7/production',
    '/api/projects/7/schedule',
    '/api/projects/7/stats',
  ];

  it('refuse les quatre lectures à qui ne gère pas le projet — CLIENT compris', async () => {
    manageAllowed = false;
    for (const path of paths) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(403);
    }
    // Aucun service n'est atteint : le refus précède la lecture, il ne la filtre pas après.
    expect(vi.mocked(GridService.getProjectGrid)).not.toHaveBeenCalled();
    expect(getSchedule).not.toHaveBeenCalled();
  });

  it('laisse passer qui gère le projet', async () => {
    for (const path of paths) expect((await request(app).get(path)).status, path).toBe(200);
  });
});
