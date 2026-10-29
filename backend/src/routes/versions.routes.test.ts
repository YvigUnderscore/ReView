// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * A2-04: `transform` was `z.any().optional()`: a Json column that any project member could fill with
 * whatever shape and size they wanted, up to the body-parser limit. The viewer only ever writes four
 * numbers (orientation + scale).
 */

vi.mock('../middleware/auth', async () => ({
  ...(await import('../middleware/authUser')),
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 7, role: 'ARTIST' } as Request['user'];
    next();
  },
}));
vi.mock('../middleware/rbac', () => ({ assertProjectAccess: vi.fn(() => Promise.resolve()) }));
vi.mock('../lib/projectRoles', () => ({ assertProjectManage: vi.fn(() => Promise.resolve()) }));
vi.mock('../lib/pipeline', () => ({
  resolveProjectIdForVersion: vi.fn(() => Promise.resolve(42)),
  resolveProjectIdForTask: vi.fn(() => Promise.resolve(42)),
  resolveProjectIdForAsset: vi.fn(() => Promise.resolve(42)),
}));
vi.mock('../services/VersionService', () => ({
  create: vi.fn(),
  getDetail: vi.fn(),
  update: vi.fn(() => Promise.resolve({ id: 1 })),
  publishAll: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  purge: vi.fn(),
}));
vi.mock('../services/ReviewDecisionService', () => ({ decide: vi.fn(), history: vi.fn() }));

import express from 'express';
import request from 'supertest';
import versionRoutes from './versions.routes';
import { errorHandler } from '../middleware/error';
import * as VersionService from '../services/VersionService';

const app = express()
  .use(express.json({ limit: '2mb' }))
  .use('/api/versions', versionRoutes)
  .use(errorHandler);

const patch = (body: Record<string, unknown>) => request(app).patch('/api/versions/1').send(body);

beforeEach(() => vi.mocked(VersionService.update).mockClear());

describe('PATCH /api/versions/:id: transform schema (A2-04)', () => {
  it('accepts the orientation and scale the viewer saves', async () => {
    const transform = { yaw: 45, pitch: -12.5, roll: 0, scale: 1.75 };
    await patch({ transform }).expect(200);
    expect(vi.mocked(VersionService.update).mock.calls[0]?.[3]).toMatchObject({ transform });
  });

  it('refuses an arbitrary blob and writes nothing', async () => {
    await patch({ transform: { pad: 'A'.repeat(200_000) } }).expect(400);
    expect(VersionService.update).not.toHaveBeenCalled();
  });

  it('refuses an out-of-bounds value instead of persisting it', async () => {
    await patch({ transform: { yaw: 1e12 } }).expect(400);
    await patch({ transform: { scale: Number.POSITIVE_INFINITY } }).expect(400);
    expect(VersionService.update).not.toHaveBeenCalled();
  });

  it('lets a rename pass on its own, without a transform', async () => {
    await patch({ name: 'v003' }).expect(200);
    expect(vi.mocked(VersionService.update).mock.calls[0]?.[3]).toEqual({ name: 'v003' });
  });
});
