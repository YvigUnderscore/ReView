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
// `currentStudioId` est local au routeur et lit le premier projet venu pour son studio.
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
 * Le défaut réel corrigé ici : les deux lectures ne posaient que `authenticate`. Un compte
 * authentifié mais étranger au projet obtenait 200 sur le brief et sur l'équipe de
 * n'importe quel plan du studio, en itérant simplement sur les identifiants — alors que
 * `GET /api/projects/:id` lui répondait bien 403.
 */
describe('lecture des extras d’entité : appartenance au projet exigée', () => {
  for (const segment of SEGMENTS) {
    it(`${segment} — refuse la fiche à un non-membre`, async () => {
      access.mockRejectedValue(forbidden('No access to this project'));
      const res = await request(app).get(`/api/${segment}/8055/note`);
      expect(res.status).toBe(403);
      // Le garde-fou doit précéder la lecture : rien ne doit avoir été lu en base.
      expect(note).not.toHaveBeenCalled();
    });

    it(`${segment} — refuse l’équipe à un non-membre`, async () => {
      access.mockRejectedValue(forbidden('No access to this project'));
      const res = await request(app).get(`/api/${segment}/8055/assignees`);
      expect(res.status).toBe(403);
      expect(assignees).not.toHaveBeenCalled();
    });

    it(`${segment} — sert la fiche à un membre`, async () => {
      const res = await request(app).get(`/api/${segment}/8055/note`);
      expect(res.status).toBe(200);
      expect(res.body.note.body).toBe('brief interne');
      expect(access).toHaveBeenCalledWith(expect.anything(), 461);
    });
  }

  it('résout le projet depuis l’entité, pas depuis la requête', async () => {
    await request(app).get('/api/shots/8055/note');
    expect(resolveProject).toHaveBeenCalledWith('shot', 8055);
  });
});

/**
 * Les modèles de fiche peuvent être portés par un projet : demander ceux d'un projet
 * étranger revenait à en lire le contenu.
 */
describe('modèles de fiche : le projet demandé est vérifié', () => {
  it('refuse un projectId auquel on n’a pas accès', async () => {
    access.mockRejectedValue(forbidden('No access to this project'));
    const res = await request(app).get('/api/note-templates?projectId=999');
    expect(res.status).toBe(403);
  });

  it('laisse passer la demande sans projectId (modèles de studio)', async () => {
    const res = await request(app).get('/api/note-templates');
    expect(res.status).toBe(200);
    expect(access).not.toHaveBeenCalled();
  });
});
