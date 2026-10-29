// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * Writes at the Episode level: creation (and its ShotGrid lock), batch, ordering, attachment of
 * sequences, and trash. A file separate from the read contract: the two-hundred-line budget also
 * applies to route tests.
 */

const { episodes, guard, trash, audit } = vi.hoisted(() => ({
  episodes: {
    readSettings: vi.fn(),
    setEnabled: vi.fn(),
    assertEnabled: vi.fn().mockResolvedValue(undefined),
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
  audit: { logAudit: vi.fn() },
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
vi.mock('../services/AuditService', () => audit);
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
  episodes.assertEnabled.mockResolvedValue(undefined);
  guard.assertEpisodeCreationAllowed.mockResolvedValue(undefined);
});

describe('creation', () => {
  it('creates and returns 201', async () => {
    episodes.create.mockResolvedValue({ id: 4, code: 'EP101' });
    const res = await request(app)
      .post('/api/episodes')
      .send({ projectId: 7, name: 'Pilote', code: 'EP101' });
    expect(res.status).toBe(201);
    expect(episodes.create).toHaveBeenCalledWith(7, { name: 'Pilote', code: 'EP101' });
  });

  it('stops at the ShotGrid lock before any write', async () => {
    guard.assertEpisodeCreationAllowed.mockRejectedValue(
      new AppError('driven from ShotGrid', 409, 'SHOTGRID_LOCKED'),
    );
    const res = await request(app).post('/api/episodes').send({ projectId: 7, name: 'a', code: 'EP101' });
    expect(res.status).toBe(409);
    expect(episodes.create).not.toHaveBeenCalled();
  });

  it('rejects an empty code', async () => {
    const res = await request(app).post('/api/episodes').send({ projectId: 7, name: 'a', code: '' });
    expect(res.status).toBe(400);
  });

  it('caps the batch at two hundred items', async () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ name: `E${i}`, code: `EP${i}` }));
    const res = await request(app).post('/api/episodes/bulk').send({ projectId: 7, items });
    expect(res.status).toBe(400);
    expect(episodes.createBulk).not.toHaveBeenCalled();
  });
});

describe('ordering and attachment', () => {
  it('reorders in the order received', async () => {
    const res = await request(app)
      .post('/api/episodes/reorder')
      .send({ projectId: 7, ids: [3, 1, 2] });
    expect(res.status).toBe(204);
    expect(episodes.reorder).toHaveBeenCalledWith(7, [3, 1, 2]);
  });

  it('rejects an empty ordering list', async () => {
    expect((await request(app).post('/api/episodes/reorder').send({ projectId: 7, ids: [] })).status).toBe(
      400,
    );
  });

  it('attaches sequences and returns the count actually written', async () => {
    episodes.assignSequences.mockResolvedValue(2);
    const res = await request(app)
      .post('/api/episodes/assign')
      .send({ projectId: 7, episodeId: 4, sequenceIds: [10, 11] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });

  it('accepts detachment (null episodeId)', async () => {
    episodes.assignSequences.mockResolvedValue(1);
    const res = await request(app)
      .post('/api/episodes/assign')
      .send({ projectId: 7, episodeId: null, sequenceIds: [10] });
    expect(res.status).toBe(200);
    expect(episodes.assignSequences).toHaveBeenCalledWith(7, null, [10]);
  });
});

describe('editing', () => {
  it('accepts a null status (clearing)', async () => {
    episodes.update.mockResolvedValue({ id: 4 });
    const res = await request(app).patch('/api/episodes/4').send({ pipelineStatusId: null });
    expect(res.status).toBe(200);
    expect(episodes.update).toHaveBeenCalledWith(4, 7, { pipelineStatusId: null });
  });

  it('rejects an oversized description', async () => {
    const res = await request(app)
      .patch('/api/episodes/4')
      .send({ description: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
  });
});

describe('trash', () => {
  it('moves to the trash and logs', async () => {
    expect((await request(app).delete('/api/episodes/4')).status).toBe(204);
    expect(trash.softDeleteEpisode).toHaveBeenCalledWith(4);
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'EPISODE_DELETE' }));
  });

  it('restores', async () => {
    expect((await request(app).post('/api/episodes/4/restore')).status).toBe(204);
    expect(trash.restoreEpisode).toHaveBeenCalledWith(4);
  });

  it('purges and logs', async () => {
    expect((await request(app).delete('/api/episodes/4/purge')).status).toBe(204);
    expect(trash.purgeEpisode).toHaveBeenCalledWith(4);
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'EPISODE_PURGE' }));
  });
});
