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
vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 7, role: 'ADMIN' } as Request['user'];
    next();
  },
}));
vi.mock('../middleware/rbac', () => ({
  requireProjectAccess: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

import express from 'express';
import request from 'supertest';
import productionRoutes from './production.routes';
import * as ScheduleService from '../services/ScheduleService';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/projects', productionRoutes).use(errorHandler);
const getSchedule = vi.mocked(ScheduleService.getProjectSchedule);

beforeEach(() => vi.clearAllMocks());

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
