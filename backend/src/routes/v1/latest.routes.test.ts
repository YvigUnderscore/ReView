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
      // `count`: the project access guard first checks that the project is not in the trash
      // (`middleware/rbac`). It never is in this file.
      project: { findFirst: vi.fn(), count: vi.fn(() => Promise.resolve(1)) },
      sequence: { findFirst: vi.fn() },
      shot: { findFirst: vi.fn() },
      task: { findFirst: vi.fn(), findUnique: vi.fn() },
      version: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
      projectMembership: { findUnique: vi.fn() },
    },
    caller,
  };
});

vi.mock('../../lib/prisma', () => ({ prisma: db }));
// PARTIAL mock: the module also exports Zod schemas that a router mounted here builds at import
// time (`reviewNoteSchema`). A full mock would make them disappear and mounting would fail
// before the first test.
vi.mock('../../lib/projectSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/projectSettings')>()),
  // The project's pipe: it is what lets compositing win over animation.
  resolveProjectSettingsById: vi.fn(() =>
    Promise.resolve({
      departments: [
        { key: 'anim', name: 'Animation' },
        { key: 'comp', name: 'Comp' },
      ],
    }),
  ),
}));
vi.mock('../../lib/storage', () => ({
  storage: { getPresignedGetUrl: vi.fn((key: string) => Promise.resolve(`https://minio/${key}`)) },
  StorageService: { mediaKey: vi.fn(), thumbnailKey: vi.fn() },
}));
vi.mock('../../lib/queues', () => ({ enqueueMediaJob: vi.fn(), enqueueSpatialThumb: vi.fn() }));
vi.mock('../../services/SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('../../services/AuditService', () => ({ logAudit: vi.fn() }));

import express from 'express';
import request from 'supertest';
import latestRoutes from './latest.routes';
import { errorHandler } from '../../middleware/error';

const app = express()
  .use((req: Request, _res: Response, next: NextFunction) => {
    req.user = caller.user;
    req.apiToken = caller.apiToken;
    next();
  })
  .use('/api/v1', latestRoutes)
  .use(errorHandler);

const at = (iso: string) => new Date(iso);

const mediaRow = {
  id: 128,
  kind: 'VIDEO',
  status: 'READY',
  originalName: 'SH0100_comp_v003.mov',
  mimeType: 'video/mp4',
  size: BigInt(42),
  published: true,
  createdAt: at('2026-08-20T10:00:00.000Z'),
  storageKey: 'review/proj/SH0100/V03/128/SH0100_comp_v003.mov',
  metadata: {},
};

const versionRow = {
  id: 514,
  name: 'V03',
  status: 'PUBLISHED',
  published: true,
  createdAt: at('2026-08-20T10:00:00.000Z'),
  updatedAt: at('2026-08-20T10:00:00.000Z'),
  author: { id: 9, name: 'Farm', username: 'farm', email: 'farm@studio.com' },
  reviewStatus: null,
  asset: null,
  task: {
    id: 87,
    name: 'comp',
    type: 'COMP',
    department: 'comp',
    status: 'IN_PROGRESS',
    order: 0,
    startDate: null,
    dueDate: null,
    createdAt: at('2026-08-01T10:00:00.000Z'),
    updatedAt: at('2026-08-01T10:00:00.000Z'),
    assignee: null,
    shot: { id: 42, code: 'SH0100', projectId: 42, project: { slug: 'proj' }, sequence: { code: 'SQ010' } },
    asset: null,
  },
  media: [mediaRow],
};

/** Two candidates on the same shot: the animation published after comp must not win. */
const candidates = [
  { id: 513, createdAt: at('2026-08-21T10:00:00.000Z'), task: { department: 'anim' } },
  { id: 514, createdAt: at('2026-08-20T10:00:00.000Z'), task: { department: 'comp' } },
];

beforeEach(() => {
  vi.clearAllMocks();
  caller.user = { id: 7, email: 'artist@studio.com', role: 'ARTIST' };
  caller.apiToken = undefined;
  db.projectMembership.findUnique.mockResolvedValue({ userId: 7, projectId: 42 });
  db.task.findUnique.mockResolvedValue({ shot: { projectId: 42 }, asset: null });
  db.version.findMany.mockResolvedValue(candidates);
  db.version.findUnique.mockResolvedValue(versionRow);
  // Path resolution only returns here what `/latest` reads: identifiers.
  db.project.findFirst.mockResolvedValue({ id: 42, slug: 'proj', name: 'PROJ' });
  db.sequence.findFirst.mockResolvedValue({ id: 11, code: 'SQ010', projectId: 42 });
  db.shot.findFirst.mockResolvedValue({ id: 42, code: 'SH0100', projectId: 42 });
  db.task.findFirst.mockResolvedValue(versionRow.task);
});

describe('GET /api/v1/tasks/:id/versions/latest', () => {
  it('returns the elected version and its media, without URLs by default', async () => {
    const res = await request(app).get('/api/v1/tasks/87/versions/latest');
    expect(res.status).toBe(200);
    expect(res.body.version).toMatchObject({ id: 514, name: 'V03', published: true });
    expect(res.body.version.media).toHaveLength(1);
    expect(res.body.version.media[0]).not.toHaveProperty('url');
  });

  it('includes each media URL when requested', async () => {
    const res = await request(app).get('/api/v1/tasks/87/versions/latest?urls=true');
    expect(res.body.version.media[0].url).toContain(mediaRow.storageKey);
  });

  // `published=false` serves the artist re-reading their own work: without it a draft stays
  // invisible to a DCC tool.
  it('only looks at published versions by default, drafts on request', async () => {
    await request(app).get('/api/v1/tasks/87/versions/latest');
    expect(db.version.findMany.mock.calls[0]?.[0].where).toMatchObject({ published: true, taskId: 87 });
    await request(app).get('/api/v1/tasks/87/versions/latest?published=false');
    expect(db.version.findMany.mock.calls[1]?.[0].where.published).toBeUndefined();
  });

  // An unpublished media belongs only to whoever uploaded it: `published=false` opens their own
  // drafts, never a colleague's work in progress.
  it('only shows their own drafts', async () => {
    await request(app).get('/api/v1/tasks/87/versions/latest?published=false');
    const mediaWhere = db.version.findMany.mock.calls[0]?.[0].where.media.some;
    expect(mediaWhere).toEqual({ deletedAt: null, OR: [{ published: true }, { uploaderId: 7 }] });
    expect(db.version.findUnique.mock.calls[0]?.[0].select.media.where).toEqual(mediaWhere);
  });

  it('answers 404 when nothing readable exists', async () => {
    db.version.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/v1/tasks/87/versions/latest');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NO_LATEST_VERSION');
  });

  it('refuses a token scoped to another project', async () => {
    caller.apiToken = { id: 3, scopes: ['versions:read'], projectId: 7, kind: 'SERVICE' };
    expect((await request(app).get('/api/v1/tasks/87/versions/latest')).body.code).toBe(
      'TOKEN_PROJECT_SCOPE',
    );
  });
});

describe('GET /api/v1/latest?path=', () => {
  it('elects the most advanced pipe step, not the most recent', async () => {
    const res = await request(app).get('/api/v1/latest?path=PROJ/SQ010/SH0100');
    expect(res.status).toBe(200);
    expect(db.version.findMany.mock.calls[0]?.[0].where).toMatchObject({ task: { shotId: 42 } });
    expect(db.version.findUnique.mock.calls[0]?.[0].where).toEqual({ id: 514 });
  });

  it('restricts the election to a step when one is named', async () => {
    await request(app).get('/api/v1/latest?path=PROJ/SQ010/SH0100&department=anim');
    expect(db.version.findUnique.mock.calls[0]?.[0].where).toEqual({ id: 513 });
  });

  it('refuses a path that already names a version', async () => {
    db.version.findFirst.mockResolvedValue(versionRow);
    const res = await request(app).get('/api/v1/latest?path=PROJ/SQ010/SH0100/comp/V03');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PATH_INCLUDES_VERSION');
  });

  it('refuses a path that stops at the project', async () => {
    const res = await request(app).get('/api/v1/latest?path=PROJ');
    expect(res.body.code).toBe('PATH_TOO_SHALLOW');
  });
});
