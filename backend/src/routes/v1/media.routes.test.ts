// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/** Identity injected by this file's fake authentication middleware. */
type Caller = { user: Request['user']; apiToken: Request['apiToken'] };

const { db, caller } = vi.hoisted(() => {
  const caller: Caller = { user: { id: 7, email: 'artist@studio.com', role: 'ARTIST' }, apiToken: undefined };
  return {
    db: {
      mediaObject: { findUnique: vi.fn() },
      version: { findUnique: vi.fn() },
      // `count`: the project access guard first checks that the project is not in the trash
      // (`middleware/rbac`). It never is in this file.
      project: { count: vi.fn(() => Promise.resolve(1)) },
      projectMembership: { findUnique: vi.fn() },
    },
    caller,
  };
});

vi.mock('../../lib/prisma', () => ({ prisma: db }));
vi.mock('../../services/StorageService', () => ({
  storage: {
    getPresignedGetUrl: vi.fn((key: string, ttl?: number) =>
      Promise.resolve(`https://minio/${key}?ttl=${ttl}`),
    ),
  },
  StorageService: { mediaKey: vi.fn(), thumbnailKey: vi.fn() },
}));
// `mediaSourceKey` remains the real one: it decides which file gets served. Only the heavy
// MediaService dependencies (files, socket, audit) are stubbed.
vi.mock('../../services/JobService', () => ({ enqueueMediaJob: vi.fn(), enqueueSpatialThumb: vi.fn() }));
vi.mock('../../services/SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('../../services/AuditService', () => ({ logAudit: vi.fn() }));

import express from 'express';
import request from 'supertest';
import mediaRoutes from './media.routes';
import { errorHandler } from '../../middleware/error';

const app = express()
  .use((req: Request, _res: Response, next: NextFunction) => {
    req.user = caller.user;
    req.apiToken = caller.apiToken;
    next();
  })
  .use('/api/v1', mediaRoutes)
  .use(errorHandler);

/** Published media of a shot in project 42, as the database returns it. */
const media = {
  id: 128,
  kind: 'VIDEO',
  status: 'READY',
  originalName: 'SH0100_anim_v001.mov',
  mimeType: 'video/mp4',
  size: BigInt(184_320_000),
  published: true,
  createdAt: new Date('2026-08-21T09:31:44.244Z'),
  versionId: 512,
  uploaderId: 9,
  deletedAt: null,
  storageKey: 'review/projects/proj/SH0100/V01/128/SH0100_anim_v001.mov',
  thumbnailKey: null as string | null,
  metadata: {} as Record<string, unknown>,
};

beforeEach(() => {
  vi.clearAllMocks();
  caller.user = { id: 7, email: 'artist@studio.com', role: 'ARTIST' };
  caller.apiToken = undefined;
  db.mediaObject.findUnique.mockImplementation(() => Promise.resolve({ ...media }));
  db.version.findUnique.mockResolvedValue({ task: { shot: { projectId: 42 } }, asset: null });
  db.projectMembership.findUnique.mockResolvedValue({ userId: 7, projectId: 42 });
});

describe('GET /api/v1/media/:id/url', () => {
  it('returns a presigned URL for the source, with the media record', async () => {
    const res = await request(app).get('/api/v1/media/128/url');
    expect(res.status).toBe(200);
    expect(res.body.url).toContain(media.storageKey);
    expect(res.body).toMatchObject({ mediaId: 128, variant: 'source', expiresIn: 3600 });
    expect(res.body.media).toMatchObject({ id: 128, filename: media.originalName, size: 184_320_000 });
  });

  // After transcoding the original is deleted: serving `storageKey` would return a dead URL.
  it('serves the proxy when the source was deleted after transcoding', async () => {
    db.mediaObject.findUnique.mockResolvedValue({
      ...media,
      metadata: { sourceDeleted: true, proxyKey: 'derived/128/proxy.mp4' },
    });
    const res = await request(app).get('/api/v1/media/128/url');
    expect(res.body.url).toContain('derived/128/proxy.mp4');
  });

  // Historical cut (trimming was removed in Phase 50): it is still what the review plays, so it is
  // what a tool must get, otherwise it conforms to a longer shot.
  it('serves the trimmed proxy when a historical cut exists', async () => {
    db.mediaObject.findUnique.mockResolvedValue({
      ...media,
      metadata: {
        proxyKey: 'derived/128/proxy.mp4',
        trim: { inFrame: 1005 },
        trimProxyKey: 'derived/128/trim.mp4',
      },
    });
    const res = await request(app).get('/api/v1/media/128/url?variant=proxy');
    expect(res.body.url).toContain('derived/128/trim.mp4');
  });

  it('refuses a variant this media does not have', async () => {
    const res = await request(app).get('/api/v1/media/128/url?variant=thumbnail');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('VARIANT_UNAVAILABLE');
  });

  it('honours a requested validity duration, and refuses those out of bounds', async () => {
    const ok = await request(app).get('/api/v1/media/128/url?expiresIn=120');
    expect(ok.body).toMatchObject({ expiresIn: 120 });
    expect(ok.body.url).toContain('ttl=120');
    expect((await request(app).get('/api/v1/media/128/url?expiresIn=10')).status).toBe(400);
    expect((await request(app).get('/api/v1/media/128/url?expiresIn=999999')).status).toBe(400);
  });

  it('hides a draft uploaded by someone else', async () => {
    db.mediaObject.findUnique.mockResolvedValue({ ...media, published: false, uploaderId: 99 });
    expect((await request(app).get('/api/v1/media/128/url')).status).toBe(404);
  });

  it('returns their own draft to the person who uploaded it', async () => {
    db.mediaObject.findUnique.mockResolvedValue({ ...media, published: false, uploaderId: 7 });
    expect((await request(app).get('/api/v1/media/128/url')).status).toBe(200);
  });

  it('hides a media that was moved to the trash', async () => {
    db.mediaObject.findUnique.mockResolvedValue({ ...media, deletedAt: new Date() });
    expect((await request(app).get('/api/v1/media/128/url')).status).toBe(404);
  });

  it('refuses a bearer who is not a project member', async () => {
    db.projectMembership.findUnique.mockResolvedValue(null);
    expect((await request(app).get('/api/v1/media/128/url')).status).toBe(403);
  });

  // Project scoping is the guarantee that makes a token safe to distribute to a farm.
  it('refuses a token scoped to another project', async () => {
    caller.apiToken = { id: 3, scopes: ['media:read'], projectId: 7, kind: 'SERVICE' };
    const res = await request(app).get('/api/v1/media/128/url');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TOKEN_PROJECT_SCOPE');
  });

  it('refuses a token without the media read scope', async () => {
    caller.apiToken = { id: 3, scopes: ['tasks:read'], kind: 'SERVICE' };
    const res = await request(app).get('/api/v1/media/128/url');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SCOPE_REQUIRED');
  });
});

describe('GET /api/v1/media/:id', () => {
  it('returns the media record and its version, without a URL', async () => {
    const res = await request(app).get('/api/v1/media/128');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      media: {
        id: 128,
        kind: 'VIDEO',
        status: 'READY',
        filename: media.originalName,
        mimeType: 'video/mp4',
        size: 184_320_000,
        published: true,
        createdAt: media.createdAt.toISOString(),
      },
      versionId: 512,
    });
  });

  it('answers 404 for a nonexistent media', async () => {
    db.mediaObject.findUnique.mockResolvedValue(null);
    expect((await request(app).get('/api/v1/media/404')).status).toBe(404);
  });
});
