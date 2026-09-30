// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * Contrat HTTP du niveau Épisode : l'interrupteur reste lisible quand le niveau est
 * éteint, et tout le reste répond 409 — y compris par une URL devinée, pendant que
 * l'interface prétend que le niveau n'existe pas.
 */

const { episodes, guard, trash } = vi.hoisted(() => ({
  episodes: {
    readSettings: vi.fn(),
    setEnabled: vi.fn(),
    assertEnabled: vi.fn(),
    list: vi.fn(),
    getDetail: vi.fn(),
    create: vi.fn(),
    createBulk: vi.fn(),
    update: vi.fn(),
    reorder: vi.fn(),
    assignSequences: vi.fn(),
  },
  guard: { assertEpisodeCreationAllowed: vi.fn() },
  trash: { softDeleteEpisode: vi.fn(), restoreEpisode: vi.fn(), purgeEpisode: vi.fn() },
}));

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
vi.mock('../lib/pipeline', () => ({ resolveProjectIdForEpisode: vi.fn().mockResolvedValue(7) }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('../services/AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('../services/EpisodeService', () => episodes);
vi.mock('../services/PipelineStatusService', () => ({ assertBelongsToProject: vi.fn() }));
vi.mock('../services/shotgrid/ShotgridEpisodes', () => guard);
vi.mock('../lib/trash', () => trash);

import express from 'express';
import request from 'supertest';
import episodesRoutes from './episodes.routes';
import { errorHandler } from '../middleware/error';
import { AppError } from '../lib/errors';

const app = express().use(express.json()).use('/api/episodes', episodesRoutes).use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  episodes.readSettings.mockResolvedValue({ enabled: false, episodeCount: 0, linkedSequenceCount: 0 });
  episodes.assertEnabled.mockResolvedValue(undefined);
});

describe('l’interrupteur', () => {
  it('se lit même quand le niveau est éteint', async () => {
    const res = await request(app).get('/api/episodes/settings?projectId=7');
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({ enabled: false, episodeCount: 0, linkedSequenceCount: 0 });
  });

  it('« settings » n’est pas avalé par la route /:id', async () => {
    // Déclaré après, `/:id` capturerait le segment et le refuserait en validation.
    await request(app).get('/api/episodes/settings?projectId=7');
    expect(episodes.getDetail).not.toHaveBeenCalled();
  });

  it('s’allume et rend le nouvel état', async () => {
    episodes.setEnabled.mockResolvedValue({ enabled: true, episodeCount: 3, linkedSequenceCount: 9 });
    const res = await request(app).put('/api/episodes/settings').send({ projectId: 7, enabled: true });
    expect(res.status).toBe(200);
    expect(episodes.setEnabled).toHaveBeenCalledWith(7, true);
    expect(res.body.settings.enabled).toBe(true);
  });

  it('refuse un corps sans booléen', async () => {
    const res = await request(app).put('/api/episodes/settings').send({ projectId: 7, enabled: 'oui' });
    expect(res.status).toBe(400);
    expect(episodes.setEnabled).not.toHaveBeenCalled();
  });
});

describe('quand le niveau est éteint', () => {
  beforeEach(() => {
    episodes.assertEnabled.mockRejectedValue(
      new AppError('The Episode level is disabled on this project', 409, 'EPISODES_DISABLED'),
    );
  });

  it('la liste répond 409', async () => {
    const res = await request(app).get('/api/episodes?projectId=7');
    expect(res.status).toBe(409);
    expect(episodes.list).not.toHaveBeenCalled();
  });

  it('la fiche d’un épisode répond 409, même par une URL devinée', async () => {
    const res = await request(app).get('/api/episodes/4');
    expect(res.status).toBe(409);
    expect(episodes.getDetail).not.toHaveBeenCalled();
  });
});

describe('lecture', () => {
  it('rend la liste paginée du projet', async () => {
    episodes.list.mockResolvedValue({ episodes: [], unassignedSequences: 2, total: 0 });
    const res = await request(app).get('/api/episodes?projectId=7');
    expect(res.status).toBe(200);
    expect(res.body.unassignedSequences).toBe(2);
  });

  it('exige un projectId', async () => {
    expect((await request(app).get('/api/episodes')).status).toBe(400);
  });

  it('rend la fiche complète', async () => {
    episodes.getDetail.mockResolvedValue({ id: 4, code: 'EP101' });
    const res = await request(app).get('/api/episodes/4');
    expect(res.status).toBe(200);
    expect(res.body.episode.code).toBe('EP101');
  });
});
