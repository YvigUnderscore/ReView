// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '@prisma/client';
import type { Request, Response, NextFunction } from 'express';

/**
 * Invariant: no route lets a client choose the storage key of a thumbnail.
 *
 * `EntityThumbnailService.set` rebuilds the key and checks its prefix, but the entity PATCHes still accepted
 * a free `thumbnailKey` of 512 characters and wrote it as is: the key of an attachment, a voice note or an
 * avatar then became a presigned URL valid for an hour. The check had been put on the new door and left open
 * on the old one, hence this suite, which guards the four doors at once.
 */

const { db, services } = vi.hoisted(() => ({
  db: { sequence: { update: vi.fn() } },
  services: {
    shotUpdate: vi.fn(),
    assetUpdate: vi.fn(),
    projectUpdate: vi.fn(),
    sequenceUpdate: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 1, role: Role.ADMIN } as Request['user'];
    next();
  },
}));
vi.mock('../middleware/rbac', () => {
  const pass = (_req: Request, _res: Response, next: NextFunction) => next();
  return {
    requireRole: () => pass,
    requireProjectAccess: pass,
    requireProjectManage: pass,
    assertProjectAccess: vi.fn(async () => undefined),
  };
});
vi.mock('../lib/pipeline', () => ({
  resolveProjectIdForShot: vi.fn(async () => 42),
  resolveProjectIdForSequence: vi.fn(async () => 42),
  resolveProjectIdForAsset: vi.fn(async () => 42),
}));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn(async () => undefined) }));
vi.mock('../lib/projectRoles', () => ({ effectiveProjectRole: vi.fn(async () => Role.ADMIN) }));
vi.mock('../lib/trash', () => ({
  softDeleteShot: vi.fn(),
  restoreShot: vi.fn(),
  purgeShot: vi.fn(),
  softDeleteSequence: vi.fn(),
  restoreSequence: vi.fn(),
  purgeSequence: vi.fn(),
  softDeleteAsset: vi.fn(),
  restoreAsset: vi.fn(),
  purgeAsset: vi.fn(),
}));
vi.mock('../lib/thumbnails', () => ({
  firstMediaThumbKeyForAsset: vi.fn(async () => null),
  firstMediaThumbKeysForAssets: vi.fn(async () => new Map()),
  effectiveThumbnailUrl: vi.fn(async () => null),
}));
vi.mock('../services/ShotService', () => ({ update: services.shotUpdate }));
vi.mock('../services/AssetService', () => ({ update: services.assetUpdate }));
vi.mock('../services/ProjectService', () => ({ updateProject: services.projectUpdate }));
vi.mock('../services/SequenceService', () => ({ update: services.sequenceUpdate }));
vi.mock('../services/PipelineLatestService', () => ({}));
vi.mock('../services/PipelineStatusService', () => ({ assertBelongsToProject: vi.fn() }));
vi.mock('../services/shotgrid/ShotgridGuardService', () => ({ assertLocalCreationAllowed: vi.fn() }));
vi.mock('../services/shotgrid/ShotgridPushService', () => ({ enqueuePush: vi.fn() }));

import express from 'express';
import request from 'supertest';
import shotsRoutes from './shots.routes';
import assetsRoutes from './assets.routes';
import sequencesRoutes from './sequences.routes';
import projectsRoutes from './projects.routes';
import { errorHandler } from '../middleware/error';

const app = express()
  .use(express.json())
  .use('/api/shots', shotsRoutes)
  .use('/api/assets', assetsRoutes)
  .use('/api/sequences', sequencesRoutes)
  .use('/api/projects', projectsRoutes)
  .use(errorHandler);

/** The key of another user's attachment: the very purpose of the attack. */
const STOLEN = 'comments/attachments/9/note-vocale.webm';

beforeEach(() => {
  vi.clearAllMocks();
  services.shotUpdate.mockResolvedValue({ id: 1 });
  services.assetUpdate.mockResolvedValue({ id: 1 });
  services.projectUpdate.mockResolvedValue({ id: 1 });
  db.sequence.update.mockResolvedValue({ id: 1 });
});

describe('entity PATCH — the thumbnail is not chosen by the key', () => {
  it('PATCH /api/shots/:id writes the name, never the key received', async () => {
    const res = await request(app).patch('/api/shots/1').send({ name: 'SH010', thumbnailKey: STOLEN });
    expect(res.status).toBe(200);
    const body = services.shotUpdate.mock.calls[0]![2] as Record<string, unknown>;
    expect(body).toEqual({ name: 'SH010' });
    expect(body).not.toHaveProperty('thumbnailKey');
  });

  it('PATCH /api/assets/:id writes the name, never the key received', async () => {
    const res = await request(app).patch('/api/assets/1').send({ name: 'Robot', thumbnailKey: STOLEN });
    expect(res.status).toBe(200);
    const body = services.assetUpdate.mock.calls[0]![2] as Record<string, unknown>;
    expect(body).toEqual({ name: 'Robot' });
    expect(body).not.toHaveProperty('thumbnailKey');
  });

  it('PATCH /api/sequences/:id writes the name, never the key received', async () => {
    const res = await request(app).patch('/api/sequences/1').send({ name: 'SQ01', thumbnailKey: STOLEN });
    expect(res.status).toBe(200);
    // The body now goes through `SequenceService.update`: that is where we check what the route let in,
    // the door to guard having not changed place.
    const body = services.sequenceUpdate.mock.calls[0]![2] as Record<string, unknown>;
    expect(body).toEqual({ name: 'SQ01' });
    expect(body).not.toHaveProperty('thumbnailKey');
  });

  it('PATCH /api/projects/:projectId writes the name, never the key received', async () => {
    const res = await request(app).patch('/api/projects/42').send({ name: 'Démo', thumbnailKey: STOLEN });
    expect(res.status).toBe(200);
    const body = services.projectUpdate.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toEqual({ name: 'Démo' });
    expect(body).not.toHaveProperty('thumbnailKey');
  });

  it('ignores the key even when it is alone in the body, without failing the request', async () => {
    // The Zod schema strips the unknown property: the caller receives 200 and nothing is written from its
    // key; a 400 would bring down the integrations that still send it.
    const res = await request(app).patch('/api/shots/1').send({ thumbnailKey: STOLEN });
    expect(res.status).toBe(200);
    expect(services.shotUpdate.mock.calls[0]![2]).toEqual({});
  });
});
