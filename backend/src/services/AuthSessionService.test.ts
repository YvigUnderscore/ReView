// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, sessions } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn() } },
  sessions: { isSessionActive: vi.fn(), touchSession: vi.fn(), revokeSession: vi.fn() },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/sessions', () => sessions);

import { signAccessToken, signRefreshToken, verifyToken } from '../lib/jwt';
import { endSession, renewSession } from './AuthSessionService';

const user = { id: 7, email: 'a@b.c', role: 'ARTIST' as const, disabledAt: null };
const refreshFor = (sid = 's1') => signRefreshToken({ id: 7, email: 'a@b.c', role: 'ARTIST', sid });

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue(user);
  sessions.isSessionActive.mockResolvedValue(true);
});

describe('renewSession', () => {
  it('issues a fresh access token and a rotated refresh token for the same session', async () => {
    const out = await renewSession(refreshFor());
    expect(verifyToken(out.accessToken)).toMatchObject({ id: 7, sid: 's1' });
    expect(verifyToken(out.accessToken)?.kind).toBeUndefined();
    expect(verifyToken(out.refreshToken)).toMatchObject({ id: 7, sid: 's1', kind: 'refresh' });
    expect(sessions.touchSession).toHaveBeenCalledWith('s1');
  });

  it.each([
    ['no token', null, 'NO_REFRESH_TOKEN'],
    ['garbage', 'not-a-jwt', undefined],
    ['an access token', signAccessToken({ id: 7, email: 'a@b.c', role: 'ARTIST', sid: 's1' }), undefined],
  ])('refuses %s', async (_label, token, code) => {
    await expect(renewSession(token)).rejects.toMatchObject({ statusCode: 401, ...(code ? { code } : {}) });
  });

  it('refuses a vanished or disabled account, and a revoked session', async () => {
    db.user.findUnique.mockResolvedValueOnce(null);
    await expect(renewSession(refreshFor())).rejects.toMatchObject({ statusCode: 401 });
    db.user.findUnique.mockResolvedValueOnce({ ...user, disabledAt: new Date() });
    await expect(renewSession(refreshFor())).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' });
    sessions.isSessionActive.mockResolvedValueOnce(false);
    await expect(renewSession(refreshFor())).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    expect(sessions.touchSession).not.toHaveBeenCalled();
  });
});

describe('endSession', () => {
  it("revokes the refresh token's session, bounded to its owner", async () => {
    await endSession(refreshFor('s9'));
    expect(sessions.revokeSession).toHaveBeenCalledWith('s9', 7);
  });

  it('does nothing without a valid refresh token', async () => {
    await endSession(null);
    await endSession('garbage');
    await endSession(signAccessToken({ id: 7, email: 'a@b.c', role: 'ARTIST', sid: 's1' }));
    expect(sessions.revokeSession).not.toHaveBeenCalled();
  });
});
