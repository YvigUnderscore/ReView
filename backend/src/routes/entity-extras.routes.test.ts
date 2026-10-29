// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { access, note, assignees, resolveProject } = vi.hoisted(() => ({
  access: vi.fn(),
  note: vi.fn(),
  assignees: vi.fn(),
  resolveProject: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: 42, role: 'ARTIST', email: 'a@b.c' };
    next();
  },
}));
vi.mock('../middleware/rbac', () => ({
  assertProjectAccess: access,
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../services/EntityNoteService', () => ({
  NOTE_KINDS: ['episode', 'sequence', 'shot', 'asset'],
  TEMPLATE_SCOPES: ['all', 'episode', 'sequence', 'shot', 'asset'],
  resolveProject,
  getNote: note,
  setNote: vi.fn(),
  listTemplates: vi.fn().mockResolvedValue([]),
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));
vi.mock('../services/EntityAssigneeService', () => ({
  scopeAssignees: assignees,
  setAssignees: vi.fn(),
}));
// `currentStudioId` is local to the router and reads the first project that comes along for its studio.
vi.mock('../lib/prisma', () => ({
  prisma: { project: { findFirst: vi.fn().mockResolvedValue({ studioId: 1 }) } },
}));

import express from 'express';
import request from 'supertest';
import entityExtrasRoutes from './entity-extras.routes';
import { errorHandler } from '../middleware/error';
import { forbidden } from '../lib/errors';

const app = express().use(express.json()).use('/api', entityExtrasRoutes).use(errorHandler);

const SEGMENTS = ['episodes', 'sequences', 'shots', 'assets'] as const;

beforeEach(() => {
  vi.clearAllMocks();
  resolveProject.mockResolvedValue(461);
  note.mockResolvedValue({ body: 'brief interne', updatedAt: null, updatedBy: null });
  assignees.mockResolvedValue([]);
  access.mockResolvedValue(undefined);
});

/**
 * The real defect fixed here: both reads only applied `authenticate`. An authenticated account that
 * was a stranger to the project obtained a 200 on the brief and on the team of any shot in the studio,
 * simply by iterating over identifiers, whereas `GET /api/projects/:id` answered it with a 403.
 */
describe('reading entity extras: project membership required', () => {
  for (const segment of SEGMENTS) {
    it(`${segment} — refuses the record to a non-member`, async () => {
      access.mockRejectedValue(forbidden('No access to this project'));
      const res = await request(app).get(`/api/${segment}/8055/note`);
      expect(res.status).toBe(403);
      // The guard must precede the read: nothing must have been read from the database.
      expect(note).not.toHaveBeenCalled();
    });

    it(`${segment} — refuses the team to a non-member`, async () => {
      access.mockRejectedValue(forbidden('No access to this project'));
      const res = await request(app).get(`/api/${segment}/8055/assignees`);
      expect(res.status).toBe(403);
      expect(assignees).not.toHaveBeenCalled();
    });

    it(`${segment} — serves the record to a member`, async () => {
      const res = await request(app).get(`/api/${segment}/8055/note`);
      expect(res.status).toBe(200);
      expect(res.body.note.body).toBe('brief interne');
      expect(access).toHaveBeenCalledWith(expect.anything(), 461);
    });
  }

  it('resolves the project from the entity, not from the request', async () => {
    await request(app).get('/api/shots/8055/note');
    expect(resolveProject).toHaveBeenCalledWith('shot', 8055);
  });
});

/**
 * Record templates can belong to a project: asking for those of a foreign project amounted to reading
 * its content.
 */
describe('record templates: the requested project is verified', () => {
  it('rejects a projectId the caller has no access to', async () => {
    access.mockRejectedValue(forbidden('No access to this project'));
    const res = await request(app).get('/api/note-templates?projectId=999');
    expect(res.status).toBe(403);
  });

  it('lets the request through without a projectId (studio templates)', async () => {
    const res = await request(app).get('/api/note-templates');
    expect(res.status).toBe(200);
    expect(access).not.toHaveBeenCalled();
  });
});
