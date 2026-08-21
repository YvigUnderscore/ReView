// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '@prisma/client';
import type { Request, Response, NextFunction } from 'express';

/**
 * Invariant : aucune route ne laisse un client choisir la clé de stockage d'une vignette.
 *
 * `EntityThumbnailService.set` reconstruit la clé et vérifie son préfixe, mais les PATCH
 * d'entité acceptaient encore un `thumbnailKey` libre de 512 caractères et l'écrivaient
 * tel quel : la clé d'une pièce jointe, d'une note vocale ou d'un avatar y devenait une
 * URL présignée valable une heure. Le contrôle avait été posé sur la porte neuve et laissé
 * ouvert sur l'ancienne — d'où cette suite, qui garde les quatre portes à la fois.
 */

const { db, services } = vi.hoisted(() => ({
  db: { sequence: { update: vi.fn() } },
  services: {
    shotUpdate: vi.fn(),
    assetUpdate: vi.fn(),
    projectUpdate: vi.fn(),
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
vi.mock('../services/SequenceService', () => ({}));
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

/** La clé d'une pièce jointe d'un autre utilisateur : le but même de l'attaque. */
const STOLEN = 'comments/attachments/9/note-vocale.webm';

beforeEach(() => {
  vi.clearAllMocks();
  services.shotUpdate.mockResolvedValue({ id: 1 });
  services.assetUpdate.mockResolvedValue({ id: 1 });
  services.projectUpdate.mockResolvedValue({ id: 1 });
  db.sequence.update.mockResolvedValue({ id: 1 });
});

describe('PATCH d’entité — la vignette ne se choisit pas par la clé', () => {
  it('PATCH /api/shots/:id écrit le nom, jamais la clé reçue', async () => {
    const res = await request(app).patch('/api/shots/1').send({ name: 'SH010', thumbnailKey: STOLEN });
    expect(res.status).toBe(200);
    const body = services.shotUpdate.mock.calls[0]![2] as Record<string, unknown>;
    expect(body).toEqual({ name: 'SH010' });
    expect(body).not.toHaveProperty('thumbnailKey');
  });

  it('PATCH /api/assets/:id écrit le nom, jamais la clé reçue', async () => {
    const res = await request(app).patch('/api/assets/1').send({ name: 'Robot', thumbnailKey: STOLEN });
    expect(res.status).toBe(200);
    const body = services.assetUpdate.mock.calls[0]![2] as Record<string, unknown>;
    expect(body).toEqual({ name: 'Robot' });
    expect(body).not.toHaveProperty('thumbnailKey');
  });

  it('PATCH /api/sequences/:id écrit le nom, jamais la clé reçue', async () => {
    const res = await request(app).patch('/api/sequences/1').send({ name: 'SQ01', thumbnailKey: STOLEN });
    expect(res.status).toBe(200);
    const args = db.sequence.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(args.data).toEqual({ name: 'SQ01' });
    expect(args.data).not.toHaveProperty('thumbnailKey');
  });

  it('PATCH /api/projects/:projectId écrit le nom, jamais la clé reçue', async () => {
    const res = await request(app).patch('/api/projects/42').send({ name: 'Démo', thumbnailKey: STOLEN });
    expect(res.status).toBe(200);
    const body = services.projectUpdate.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toEqual({ name: 'Démo' });
    expect(body).not.toHaveProperty('thumbnailKey');
  });

  it('ignore la clé même seule dans le corps, sans faire échouer la requête', async () => {
    // Le schéma Zod retire la propriété inconnue : l'appelant reçoit 200 et rien n'est
    // écrit de sa clé — un 400 ferait tomber les intégrations qui l'envoient encore.
    const res = await request(app).patch('/api/shots/1').send({ thumbnailKey: STOLEN });
    expect(res.status).toBe(200);
    expect(services.shotUpdate.mock.calls[0]![2]).toEqual({});
  });
});
