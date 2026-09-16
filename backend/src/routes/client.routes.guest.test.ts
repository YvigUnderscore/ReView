// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Surface PUBLIQUE de partage — la seule écriture de l'application ouverte à un anonyme.
 *
 * Deux constats se referment ici :
 *  - **A2-02** : `POST /:token/media/:id/comments` n'avait aucun frein de débit, alors que
 *    `/unlock`, juste au-dessus, en a un. Chaque appel crée une ligne, diffuse une socket,
 *    part en webhook et en note ShotGrid.
 *  - **A2-04** : `cameraState` y était déclaré `z.any()`, c'est-à-dire du JSON de forme et
 *    de volume libres écrits en base sur présentation d'un lien.
 */

const { db, share, media } = vi.hoisted(() => ({
  db: { comment: { findMany: vi.fn() } },
  share: {
    id: 3,
    projectId: 42,
    createdById: 9,
    permission: 'COMMENT',
    scope: {},
    label: 'Client',
    passwordHash: null,
  },
  media: { id: 128, storageKey: 'review/x.mp4', metadata: {} },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../services/StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn(() => Promise.resolve('https://minio/x?sig')) },
  StorageService: { mediaKey: vi.fn(), thumbnailKey: vi.fn() },
}));
vi.mock('../services/ClientShareService', () => ({
  loadShare: vi.fn(() => Promise.resolve(share)),
  loadShareWithSession: vi.fn(() => Promise.resolve(share)),
  consumeView: vi.fn(),
  studioBranding: vi.fn(() => Promise.resolve({})),
  listShareMedia: vi.fn(() => Promise.resolve({ media: [], total: 0, hasMore: false })),
  findShareMedia: vi.fn(() => Promise.resolve(media)),
}));
vi.mock('../services/CommentService', () => ({
  createGuest: vi.fn(() => Promise.resolve({ id: 1, content: 'ok' })),
}));
vi.mock('../lib/shareAccess', () => ({
  signShareSession: vi.fn(() => 'share-auth'),
  verifyShareSession: vi.fn(() => true),
}));
vi.mock('../lib/watermarkConfig', () => ({
  getWatermarkConfig: vi.fn(() => Promise.resolve({ shares: false, opacity: 0.2 })),
}));
vi.mock('../services/AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('../lib/mediaAccess', () => ({ logMediaAccess: vi.fn() }));
vi.mock('../services/JobService', () => ({ enqueueMediaJob: vi.fn(), enqueueSpatialThumb: vi.fn() }));
vi.mock('../services/SocketService', () => ({ emitToProject: vi.fn() }));

import express from 'express';
import request from 'supertest';
import clientRoutes from './client.routes';
import { errorHandler } from '../middleware/error';
import { createGuest } from '../services/CommentService';

/** Même plafond de corps que `app.ts` : c'est le schéma qu'on mesure, pas le parseur. */
const json = express.json({ limit: '2mb' });
const app = express().use(json).use('/api/client', clientRoutes).use(errorHandler);
/** Même routeur, mais derrière un proxy de confiance : `req.ip` y suit `X-Forwarded-For`. */
const behindProxy = express();
behindProxy.set('trust proxy', true);
behindProxy.use(json).use('/api/client', clientRoutes).use(errorHandler);

/** Les compteurs sont keyés sur le jeton : un jeton par cas = un budget neuf. */
const tokenOf = (name: string) => name.padEnd(24, 'x');

const post = (token: string, body: Record<string, unknown>) =>
  request(app).post(`/api/client/${token}/media/128/comments`).send(body);

const comment = { guestName: 'Claire', content: 'le raccord saute' };

beforeEach(() => vi.mocked(createGuest).mockClear());

describe('POST /:token/media/:id/comments — schéma de la pose caméra (A2-04)', () => {
  it('accepte la pose que le viewer 3D envoie réellement', async () => {
    const cameraState = { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 }, fov: 45 };
    await post(tokenOf('shape-ok'), { ...comment, cameraState }).expect(201);
    expect(vi.mocked(createGuest).mock.calls[0]?.[2]).toMatchObject({ cameraState });
  });

  it('refuse un blob quelconque et n’écrit rien', async () => {
    const cameraState = { pad: 'A'.repeat(200_000) };
    await post(tokenOf('shape-ko'), { ...comment, cameraState }).expect(400);
    expect(createGuest).not.toHaveBeenCalled();
  });

  it('tolère l’absence de pose comme le fait la page de partage', async () => {
    await post(tokenOf('shape-nul'), { ...comment, cameraState: null }).expect(201);
  });
});

describe('POST /:token/media/:id/comments — frein de débit (A2-02)', () => {
  it('borne un invité à trente commentaires par quart d’heure, puis refuse en 429', async () => {
    const token = tokenOf('freinip');
    for (let i = 0; i < 30; i += 1) {
      expect((await post(token, comment)).status).toBe(201);
    }
    const blocked = await post(token, comment);
    expect(blocked.status).toBe(429);
    expect(vi.mocked(createGuest)).toHaveBeenCalledTimes(30);
  });

  /**
   * Le point qui justifie la double clé : sous `TRUST_PROXY`, l'IP est ce que l'appelant
   * déclare. La renouveler rouvre autant de compteurs par IP qu'on veut — et ne rouvre
   * rien du compteur par lien, qui est le seul plafond réellement infalsifiable ici.
   */
  it('ne se laisse pas rouvrir en changeant d’adresse déclarée', async () => {
    const token = tokenOf('freinlien');
    const send = (ip: string) =>
      request(behindProxy)
        .post(`/api/client/${token}/media/128/comments`)
        .set('X-Forwarded-For', ip)
        .send(comment);
    for (let i = 0; i < 120; i += 1) {
      expect((await send(`10.0.0.${i}`)).status).toBe(201);
    }
    // 121ᵉ appel, adresse encore jamais vue : son compteur par IP est vierge, le budget du
    // lien ne l'est plus.
    expect((await send('10.9.9.9')).status).toBe(429);
  });
});
