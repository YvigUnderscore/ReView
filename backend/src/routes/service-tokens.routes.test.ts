// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

interface Actor {
  current: { id: number; role: string };
  apiToken?: { id: number };
}

const { svc, actor } = vi.hoisted(() => {
  const state: Actor = { current: { id: 1, role: 'ADMIN' } };
  return {
    svc: {
      listService: vi.fn(),
      createService: vi.fn(),
      revokeService: vi.fn(),
      assertActorPassword: vi.fn(),
    },
    actor: state,
  };
});

vi.mock('../services/ApiTokenService', () => svc);
vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = actor.current as Request['user'];
    req.apiToken = actor.apiToken as Request['apiToken'];
    next();
  },
}));

import express from 'express';
import request from 'supertest';
import serviceTokenRoutes from './service-tokens.routes';
import { errorHandler } from '../middleware/error';
import { forbidden } from '../lib/errors';

const app = express()
  .use(express.json())
  .use('/api/admin/service-tokens', serviceTokenRoutes)
  .use(errorHandler);

const VALID = {
  name: 'Render farm',
  scopes: ['versions:write'],
  role: 'ARTIST',
  projectId: 4,
  expiresInDays: 90,
  currentPassword: 'Motdepasse1',
};

beforeEach(() => {
  vi.clearAllMocks();
  actor.current = { id: 1, role: 'ADMIN' };
  actor.apiToken = undefined;
  svc.listService.mockResolvedValue([]);
  svc.createService.mockResolvedValue({ token: 'rvk_secret', apiToken: { id: 9 } });
  svc.assertActorPassword.mockResolvedValue(undefined);
  svc.revokeService.mockResolvedValue(undefined);
});

describe('GET /api/admin/service-tokens', () => {
  it('serves the list to admins', async () => {
    svc.listService.mockResolvedValue([{ id: 9, name: 'Render farm' }]);
    const res = await request(app).get('/api/admin/service-tokens');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tokens: [{ id: 9, name: 'Render farm' }] });
  });

  it('rejects a non-admin', async () => {
    actor.current = { id: 2, role: 'SUPERVISOR' };
    const res = await request(app).get('/api/admin/service-tokens');
    expect(res.status).toBe(403);
    expect(svc.listService).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/service-tokens', () => {
  it('issues the token and returns the secret only once', async () => {
    const res = await request(app).post('/api/admin/service-tokens').send(VALID);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ token: 'rvk_secret' });
    expect(svc.createService).toHaveBeenCalledWith(1, {
      name: 'Render farm',
      scopes: ['versions:write'],
      role: 'ARTIST',
      projectId: 4,
      expiresInDays: 90,
    });
  });

  // The password must never fall back into the issuing service (nor into the audit).
  it('does not pass the password on to the issuing service', async () => {
    await request(app).post('/api/admin/service-tokens').send(VALID);
    const input = svc.createService.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(input).not.toHaveProperty('currentPassword');
  });

  it('re-authenticates the admin before any issuance', async () => {
    svc.assertActorPassword.mockRejectedValue(
      forbidden('The current password is required', 'CURRENT_PASSWORD_REQUIRED'),
    );
    const res = await request(app)
      .post('/api/admin/service-tokens')
      .send({ ...VALID, currentPassword: 'MauvaisMdp1' });
    expect(res.status).toBe(403);
    expect((res.body as { code?: string }).code).toBe('CURRENT_PASSWORD_REQUIRED');
    expect(svc.createService).not.toHaveBeenCalled();
  });

  it('calls re-authentication even without a password supplied', async () => {
    const { currentPassword: _omit, ...withoutPassword } = VALID;
    await request(app).post('/api/admin/service-tokens').send(withoutPassword);
    expect(svc.assertActorPassword).toHaveBeenCalledWith(1, undefined);
  });

  // ADMIN deliberately kept out of the enumeration: a bot does not run the studio.
  it('rejects the ADMIN role', async () => {
    const res = await request(app)
      .post('/api/admin/service-tokens')
      .send({ ...VALID, role: 'ADMIN' });
    expect(res.status).toBe(400);
    expect(svc.createService).not.toHaveBeenCalled();
  });

  it('rejects an empty list of scopes', async () => {
    const res = await request(app)
      .post('/api/admin/service-tokens')
      .send({ ...VALID, scopes: [] });
    expect(res.status).toBe(400);
    expect(svc.createService).not.toHaveBeenCalled();
  });

  // Anti-multiplication: a leaked token must not be able to forge others.
  it('rejects a bearer that is itself an API token', async () => {
    actor.apiToken = { id: 3 };
    const res = await request(app).post('/api/admin/service-tokens').send(VALID);
    expect(res.status).toBe(400);
    expect(svc.assertActorPassword).not.toHaveBeenCalled();
    expect(svc.createService).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/service-tokens/:id', () => {
  it('revokes and responds 204', async () => {
    const res = await request(app).delete('/api/admin/service-tokens/9');
    expect(res.status).toBe(204);
    expect(svc.revokeService).toHaveBeenCalledWith(1, 9);
  });

  it('rejects a non-admin', async () => {
    actor.current = { id: 2, role: 'ARTIST' };
    const res = await request(app).delete('/api/admin/service-tokens/9');
    expect(res.status).toBe(403);
    expect(svc.revokeService).not.toHaveBeenCalled();
  });
});
