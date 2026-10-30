// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const { actor, tokens, sessions, logAudit } = vi.hoisted(() => ({
  actor: {
    current: { id: 7, role: 'ARTIST' },
    apiToken: undefined as { id: number } | undefined,
    sessionId: undefined as string | undefined,
  },
  tokens: {
    createPersonal: vi.fn(),
    listPersonal: vi.fn(),
    revokePersonal: vi.fn(),
    assertActorPassword: vi.fn(),
  },
  sessions: { listActiveSessions: vi.fn(), revokeSession: vi.fn() },
  logAudit: vi.fn(),
}));

vi.mock('../services/ApiTokenService', () => tokens);
vi.mock('../services/AuditService', () => ({ logAudit }));
vi.mock('../lib/sessions', () => sessions);
vi.mock('../middleware/auth', async () => ({
  ...(await import('../middleware/authUser')),
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = actor.current as Request['user'];
    req.apiToken = actor.apiToken as Request['apiToken'];
    req.sessionId = actor.sessionId;
    next();
  },
}));

import express from 'express';
import request from 'supertest';
import authSecurityRoutes from './auth-security.routes';
import { errorHandler } from '../middleware/error';
import { forbidden, notFound } from '../lib/errors';

const app = express().use(express.json()).use('/api/auth', authSecurityRoutes).use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  actor.current = { id: 7, role: 'ARTIST' };
  actor.apiToken = undefined;
  actor.sessionId = 'sid-current';
  tokens.createPersonal.mockResolvedValue({ token: 'rvk_secret', apiToken: { id: 1 } });
  tokens.assertActorPassword.mockImplementation(async (_id: number, password?: string) => {
    if (password !== 'Motdepasse1')
      throw forbidden('The current password is required', 'CURRENT_PASSWORD_REQUIRED');
  });
  sessions.revokeSession.mockResolvedValue(true);
});

/**
 * An `rvk_` lives for up to 3650 days and survives closing the tab. Forged from a stolen access token,
 * it turns a passing session theft into durable access, which "log out everywhere" does not even
 * suspect. The password is the only thing the attacker does not have.
 */
describe('POST /api/auth/tokens — re-authentication', () => {
  it('refuses creation without the current password — a 403, so the client keeps its session', async () => {
    const res = await request(app)
      .post('/api/auth/tokens')
      .send({ name: 'ferme', scopes: ['read'] });
    expect(res.status).toBe(403);
    expect((res.body as { code: string }).code).toBe('CURRENT_PASSWORD_REQUIRED');
    expect(tokens.createPersonal).not.toHaveBeenCalled();
  });

  it('rejects a wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/tokens')
      .send({ name: 'ferme', scopes: ['read'], currentPassword: 'MauvaisMdp1' });
    expect(res.status).toBe(403);
    expect(tokens.assertActorPassword).toHaveBeenCalledWith(7, 'MauvaisMdp1');
    expect(tokens.createPersonal).not.toHaveBeenCalled();
  });

  it('creates the token when the password is correct', async () => {
    const res = await request(app)
      .post('/api/auth/tokens')
      .send({ name: 'ferme', scopes: ['read'], currentPassword: 'Motdepasse1' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ token: 'rvk_secret' });
    expect(tokens.createPersonal).toHaveBeenCalledWith(7, expect.objectContaining({ name: 'ferme' }));
  });

  // Anti-escalation: an API token does not mint tokens, password or not.
  it('refuses a bearer that is itself an API token', async () => {
    actor.apiToken = { id: 3 };
    const res = await request(app)
      .post('/api/auth/tokens')
      .send({ name: 'ferme', scopes: ['read'], currentPassword: 'Motdepasse1' });
    expect(res.status).toBe(400);
    expect(tokens.createPersonal).not.toHaveBeenCalled();
  });
});

describe('personal tokens', () => {
  it('lists the caller tokens', async () => {
    tokens.listPersonal.mockResolvedValue([{ id: 1, name: 'ci' }]);
    const res = await request(app).get('/api/auth/tokens');
    expect(res.body).toEqual({ tokens: [{ id: 1, name: 'ci' }] });
    expect(tokens.listPersonal).toHaveBeenCalledWith(7);
  });

  it('revokes one of its tokens, 404 for any other', async () => {
    expect((await request(app).delete('/api/auth/tokens/4')).status).toBe(204);
    expect(tokens.revokePersonal).toHaveBeenCalledWith(7, 4);
    tokens.revokePersonal.mockRejectedValueOnce(notFound('Token not found'));
    expect((await request(app).delete('/api/auth/tokens/5')).status).toBe(404);
  });

  it('serves the scope catalog', async () => {
    const res = await request(app).get('/api/auth/scopes');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.scopes)).toBe(true);
    expect(Array.isArray(res.body.legacy)).toBe(true);
  });
});

describe('sessions', () => {
  it('lists the active sessions and marks the current one', async () => {
    sessions.listActiveSessions.mockResolvedValue([{ id: 'sid-current' }, { id: 'sid-other' }]);
    const res = await request(app).get('/api/auth/sessions');
    expect(res.body.sessions).toEqual([
      { id: 'sid-current', current: true },
      { id: 'sid-other', current: false },
    ]);
  });

  it('revokes one of its sessions (audited), 404 when unknown', async () => {
    const sid = 'a'.repeat(32);
    expect((await request(app).delete(`/api/auth/sessions/${sid}`)).status).toBe(204);
    expect(sessions.revokeSession).toHaveBeenCalledWith(sid, 7);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'SESSION_REVOKE' }));
    sessions.revokeSession.mockResolvedValueOnce(false);
    expect((await request(app).delete(`/api/auth/sessions/${sid}`)).status).toBe(404);
  });

  it('logout revokes the current session and clears the refresh cookie', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(204);
    expect(sessions.revokeSession).toHaveBeenCalledWith('sid-current', 7);
    expect(String(res.headers['set-cookie'])).toMatch(/review_refresh=;.*Path=\/api\/auth\/refresh/);
  });

  it('logout from an API token (no session) still answers and clears the cookie', async () => {
    actor.sessionId = undefined;
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(204);
    expect(sessions.revokeSession).not.toHaveBeenCalled();
  });
});
