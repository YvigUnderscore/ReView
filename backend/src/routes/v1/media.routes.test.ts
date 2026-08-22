// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/** Identité jouée par le middleware d'authentification factice de ce fichier. */
type Caller = { user: Request['user']; apiToken: Request['apiToken'] };

const { db, caller } = vi.hoisted(() => {
  const caller: Caller = { user: { id: 7, email: 'artist@studio.com', role: 'ARTIST' }, apiToken: undefined };
  return {
    db: {
      mediaObject: { findUnique: vi.fn() },
      version: { findUnique: vi.fn() },
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
// `mediaSourceKey` reste le vrai : c'est lui qui décide quel fichier on sert. Seules les
// dépendances lourdes de MediaService (files, socket, audit) sont neutralisées.
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

/** Média publié d'un plan du projet 42, tel que la base le rend. */
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
  it('rend une URL présignée de la source, avec la fiche du média', async () => {
    const res = await request(app).get('/api/v1/media/128/url');
    expect(res.status).toBe(200);
    expect(res.body.url).toContain(media.storageKey);
    expect(res.body).toMatchObject({ mediaId: 128, variant: 'source', expiresIn: 3600 });
    expect(res.body.media).toMatchObject({ id: 128, filename: media.originalName, size: 184_320_000 });
  });

  // Après transcodage l'original est effacé : servir `storageKey` rendrait une URL morte.
  it('sert le proxy quand la source a été supprimée après transcodage', async () => {
    db.mediaObject.findUnique.mockResolvedValue({
      ...media,
      metadata: { sourceDeleted: true, proxyKey: 'derived/128/proxy.mp4' },
    });
    const res = await request(app).get('/api/v1/media/128/url');
    expect(res.body.url).toContain('derived/128/proxy.mp4');
  });

  // La coupe non-destructive est ce que la review joue : un outil doit obtenir la même image.
  it('sert le proxy trimé quand une coupe existe', async () => {
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

  it('refuse une variante que ce média ne porte pas', async () => {
    const res = await request(app).get('/api/v1/media/128/url?variant=thumbnail');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('VARIANT_UNAVAILABLE');
  });

  it('honore une durée de validité demandée, et refuse celles hors bornes', async () => {
    const ok = await request(app).get('/api/v1/media/128/url?expiresIn=120');
    expect(ok.body).toMatchObject({ expiresIn: 120 });
    expect(ok.body.url).toContain('ttl=120');
    expect((await request(app).get('/api/v1/media/128/url?expiresIn=10')).status).toBe(400);
    expect((await request(app).get('/api/v1/media/128/url?expiresIn=999999')).status).toBe(400);
  });

  it('cache un brouillon déposé par quelqu’un d’autre', async () => {
    db.mediaObject.findUnique.mockResolvedValue({ ...media, published: false, uploaderId: 99 });
    expect((await request(app).get('/api/v1/media/128/url')).status).toBe(404);
  });

  it('rend son propre brouillon à celui qui l’a déposé', async () => {
    db.mediaObject.findUnique.mockResolvedValue({ ...media, published: false, uploaderId: 7 });
    expect((await request(app).get('/api/v1/media/128/url')).status).toBe(200);
  });

  it('cache un média mis à la corbeille', async () => {
    db.mediaObject.findUnique.mockResolvedValue({ ...media, deletedAt: new Date() });
    expect((await request(app).get('/api/v1/media/128/url')).status).toBe(404);
  });

  it('refuse un porteur qui n’est pas membre du projet', async () => {
    db.projectMembership.findUnique.mockResolvedValue(null);
    expect((await request(app).get('/api/v1/media/128/url')).status).toBe(403);
  });

  // Le cantonnement projet est la garantie qui rend un token diffusable sur une ferme.
  it('refuse un token cantonné à un autre projet', async () => {
    caller.apiToken = { id: 3, scopes: ['media:read'], projectId: 7, kind: 'SERVICE' };
    const res = await request(app).get('/api/v1/media/128/url');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TOKEN_PROJECT_SCOPE');
  });

  it('refuse un token sans le scope de lecture des médias', async () => {
    caller.apiToken = { id: 3, scopes: ['tasks:read'], kind: 'SERVICE' };
    const res = await request(app).get('/api/v1/media/128/url');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SCOPE_REQUIRED');
  });
});

describe('GET /api/v1/media/:id', () => {
  it('rend la fiche du média et sa version, sans URL', async () => {
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

  it('répond 404 sur un média inexistant', async () => {
    db.mediaObject.findUnique.mockResolvedValue(null);
    expect((await request(app).get('/api/v1/media/404')).status).toBe(404);
  });
});
