// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * A1-07 — `?projectId=` désigne un projet : il se contrôle comme tel.
 *
 * Le vocabulaire restreint d'un projet dit qu'il existe, qu'il est (ou non) relié à un
 * site ShotGrid et ce qu'on peut y poster. Les deux routes le servaient pour n'importe
 * quel identifiant, à n'importe quel compte authentifié — et, côté v1, à un jeton
 * pourtant cantonné à un autre projet, ce que l'écran des jetons promet d'empêcher.
 */
type Caller = { user: Request['user']; apiToken: Request['apiToken'] };

const { db, caller } = vi.hoisted(() => {
  const caller: Caller = { user: { id: 7, email: 'artist@studio.com', role: 'ARTIST' }, apiToken: undefined };
  return {
    db: {
      // La garde d'accès commence par vérifier que le projet existe et n'est pas à la corbeille.
      project: { count: vi.fn(() => Promise.resolve(1)) },
      projectMembership: { findUnique: vi.fn() },
    },
    caller,
  };
});

const { listStatuses, listStatusesForProject } = vi.hoisted(() => ({
  listStatuses: vi.fn(),
  listStatusesForProject: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = caller.user;
    req.apiToken = caller.apiToken;
    next();
  },
}));
vi.mock('../services/ReviewDecisionService', () => ({
  listStatuses,
  listStatusesForProject,
  createStatus: vi.fn(),
  updateStatus: vi.fn(),
  deleteStatus: vi.fn(),
  history: vi.fn(),
}));
vi.mock('../services/ReviewAssignmentService', async () => {
  const { z } = await import('zod');
  return {
    listReviewers: vi.fn(),
    setReviewers: vi.fn(),
    updateNote: vi.fn(),
    reviewersSchema: z.array(z.unknown()),
  };
});

import express from 'express';
import request from 'supertest';
import statusRoutes from './review-statuses.routes';
import v1ReviewRoutes from './v1/review.routes';
import { errorHandler } from '../middleware/error';

const app = express()
  .use(express.json())
  .use((req: Request, _res: Response, next: NextFunction) => {
    req.user = caller.user;
    req.apiToken = caller.apiToken;
    next();
  })
  .use('/api/review-statuses', statusRoutes)
  .use('/api/v1', v1ReviewRoutes)
  .use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  caller.user = { id: 7, email: 'artist@studio.com', role: 'ARTIST' };
  caller.apiToken = undefined;
  db.project.count.mockResolvedValue(1);
  db.projectMembership.findUnique.mockResolvedValue(null);
  listStatuses.mockResolvedValue([{ id: 1, name: 'Approved' }]);
  listStatusesForProject.mockResolvedValue([{ id: 1, name: 'Approved' }]);
});

for (const path of ['/api/review-statuses', '/api/v1/review-statuses']) {
  describe(`GET ${path}?projectId= — filtrage par appartenance`, () => {
    it("refuse un projet dont l'appelant n'est pas membre", async () => {
      const res = await request(app).get(`${path}?projectId=3`);
      expect(res.status).toBe(403);
      expect(listStatusesForProject).not.toHaveBeenCalled();
    });

    it("rend 404 sur un projet qui n'existe pas ou est à la corbeille", async () => {
      db.project.count.mockResolvedValue(0);
      const res = await request(app).get(`${path}?projectId=999`);
      expect(res.status).toBe(404);
      expect(listStatusesForProject).not.toHaveBeenCalled();
    });

    it('sert le vocabulaire du projet à un membre', async () => {
      db.projectMembership.findUnique.mockResolvedValue({ role: null });
      const res = await request(app).get(`${path}?projectId=3`);
      expect(res.status).toBe(200);
      expect(listStatusesForProject).toHaveBeenCalledWith(3);
    });

    it('sans projectId : référentiel du studio, inchangé', async () => {
      const res = await request(app).get(path);
      expect(res.status).toBe(200);
      expect(listStatuses).toHaveBeenCalled();
      expect(listStatusesForProject).not.toHaveBeenCalled();
    });
  });
}

describe('GET /api/v1/review-statuses — cantonnement du jeton', () => {
  const adminWithToken = (projectId: number) => {
    caller.user = { id: 1, email: 'admin@studio.com', role: 'ADMIN' };
    caller.apiToken = { projectId, scopes: ['versions:read'] } as unknown as Request['apiToken'];
  };

  it('refuse un jeton cantonné à un autre projet, même porté par un ADMIN', async () => {
    adminWithToken(42);
    const res = await request(app).get('/api/v1/review-statuses?projectId=3');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TOKEN_PROJECT_SCOPE');
    expect(listStatusesForProject).not.toHaveBeenCalled();
  });

  it('laisse passer le jeton sur son propre projet', async () => {
    adminWithToken(3);
    const res = await request(app).get('/api/v1/review-statuses?projectId=3');
    expect(res.status).toBe(200);
    expect(listStatusesForProject).toHaveBeenCalledWith(3);
  });
});
