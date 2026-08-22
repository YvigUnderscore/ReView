// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * Contrat HTTP de la sortie des notes : ce que le navigateur reçoit (type, nom de fichier,
 * avertissement de troncature), et ce qu'un compte sans accès au projet n'obtient pas.
 */

const { exports_, rbac } = vi.hoisted(() => ({
  exports_: { resolveScopeProject: vi.fn(), exportNotes: vi.fn() },
  rbac: { assertProjectAccess: vi.fn() },
}));

vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 1, role: 'ADMIN' } as Request['user'];
    next();
  },
}));
vi.mock('../middleware/rbac', () => ({
  ...rbac,
  requireRole: () => (_r: Request, _s: Response, n: NextFunction) => n(),
}));
vi.mock('../middleware/rateLimit', () => ({
  rateLimit: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  identityRateKey: () => 'test',
}));
vi.mock('../services/CommentExportService', () => exports_);
vi.mock('../services/CommentService', () => ({}));
vi.mock('../services/TaskService', () => ({}));
vi.mock('../lib/pipeline', () => ({
  resolveProjectIdForMedia: vi.fn(),
  resolveProjectIdForComment: vi.fn(),
}));

import express from 'express';
import request from 'supertest';
import commentsRoutes from './comments.routes';
import { errorHandler } from '../middleware/error';
import { forbidden } from '../lib/errors';

const app = express().use(express.json()).use('/api/comments', commentsRoutes).use(errorHandler);

const csv = {
  filename: 'notes-media-7.csv',
  contentType: 'text/csv; charset=utf-8',
  body: 'note_id\n12',
  truncated: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  exports_.resolveScopeProject.mockResolvedValue(5);
  exports_.exportNotes.mockResolvedValue(csv);
  rbac.assertProjectAccess.mockResolvedValue(undefined);
});

describe('GET /api/comments/export', () => {
  it('sert le fichier en pièce jointe, avec son type', async () => {
    const res = await request(app).get('/api/comments/export?scope=media&id=7&format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe('attachment; filename="notes-media-7.csv"');
    expect(res.headers['x-notes-truncated']).toBeUndefined();
    expect(res.text).toContain('note_id');
  });

  it('prévient quand le fichier est incomplet', async () => {
    exports_.exportNotes.mockResolvedValue({ ...csv, truncated: true });
    const res = await request(app).get('/api/comments/export?scope=media&id=7&format=csv');
    expect(res.headers['x-notes-truncated']).toBe('1');
  });

  it('assert l’accès au projet de la portée avant de produire quoi que ce soit', async () => {
    rbac.assertProjectAccess.mockRejectedValue(forbidden('No access to this project'));
    const res = await request(app).get('/api/comments/export?scope=playlist&id=3&format=edl');
    expect(res.status).toBe(403);
    expect(exports_.exportNotes).not.toHaveBeenCalled();
  });

  it('répond 404 quand la portée n’existe pas', async () => {
    exports_.resolveScopeProject.mockResolvedValue(null);
    const res = await request(app).get('/api/comments/export?scope=timeline&id=9&format=otio');
    expect(res.status).toBe(404);
    expect(rbac.assertProjectAccess).not.toHaveBeenCalled();
  });

  it('refuse une portée ou un format inconnus', async () => {
    expect((await request(app).get('/api/comments/export?scope=studio&id=1&format=csv')).status).toBe(400);
    expect((await request(app).get('/api/comments/export?scope=media&id=1&format=xlsx')).status).toBe(400);
    expect((await request(app).get('/api/comments/export?scope=media&id=0&format=csv')).status).toBe(400);
  });

  it('transmet la portée demandée et le demandeur au service', async () => {
    await request(app).get('/api/comments/export?scope=shot&id=42&format=sheet');
    expect(exports_.exportNotes).toHaveBeenCalledWith({
      scope: 'shot',
      id: 42,
      format: 'sheet',
      viewer: { id: 1, role: 'ADMIN' },
    });
  });
});
