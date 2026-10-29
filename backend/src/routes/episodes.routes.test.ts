// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * HTTP contract of the Episode level: the switch stays readable when the level is off, and everything
 * else answers 409, including through a guessed URL, while the interface claims the level does not exist.
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

vi.mock('../middleware/auth', async () => ({
  ...(await import('../middleware/authUser')),
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

describe('the switch', () => {
  it('can be read even when the level is off', async () => {
    const res = await request(app).get('/api/episodes/settings?projectId=7');
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({ enabled: false, episodeCount: 0, linkedSequenceCount: 0 });
  });

  it('"settings" is not swallowed by the /:id route', async () => {
    // Declared after, `/:id` would capture the segment and refuse it at validation.
    await request(app).get('/api/episodes/settings?projectId=7');
    expect(episodes.getDetail).not.toHaveBeenCalled();
  });

  it('turns on and returns the new state', async () => {
    episodes.setEnabled.mockResolvedValue({ enabled: true, episodeCount: 3, linkedSequenceCount: 9 });
    const res = await request(app).put('/api/episodes/settings').send({ projectId: 7, enabled: true });
    expect(res.status).toBe(200);
    expect(episodes.setEnabled).toHaveBeenCalledWith(7, true);
    expect(res.body.settings.enabled).toBe(true);
  });

  it('rejects a body without a boolean', async () => {
    const res = await request(app).put('/api/episodes/settings').send({ projectId: 7, enabled: 'oui' });
    expect(res.status).toBe(400);
    expect(episodes.setEnabled).not.toHaveBeenCalled();
  });
});

describe('when the level is off', () => {
  beforeEach(() => {
    episodes.assertEnabled.mockRejectedValue(
      new AppError('The Episode level is disabled on this project', 409, 'EPISODES_DISABLED'),
    );
  });

  it('the list responds 409', async () => {
    const res = await request(app).get('/api/episodes?projectId=7');
    expect(res.status).toBe(409);
    expect(episodes.list).not.toHaveBeenCalled();
  });

  it("an episode's record responds 409, even through a guessed URL", async () => {
    const res = await request(app).get('/api/episodes/4');
    expect(res.status).toBe(409);
    expect(episodes.getDetail).not.toHaveBeenCalled();
  });
});

describe('reading', () => {
  it('returns the paginated list of the project', async () => {
    episodes.list.mockResolvedValue({ episodes: [], unassignedSequences: 2, total: 0 });
    const res = await request(app).get('/api/episodes?projectId=7');
    expect(res.status).toBe(200);
    expect(res.body.unassignedSequences).toBe(2);
  });

  it('requires a projectId', async () => {
    expect((await request(app).get('/api/episodes')).status).toBe(400);
  });

  it('returns the full record', async () => {
    episodes.getDetail.mockResolvedValue({ id: 4, code: 'EP101' });
    const res = await request(app).get('/api/episodes/4');
    expect(res.status).toBe(200);
    expect(res.body.episode.code).toBe('EP101');
  });
});
