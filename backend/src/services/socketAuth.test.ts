// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn() }, shareLink: { findUnique: vi.fn() } },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/sessions', () => ({ isSessionActive: vi.fn().mockResolvedValue(true) }));
vi.mock('../lib/shareAccess', () => ({
  shareState: vi.fn(() => 'ok'),
  verifyShareSession: vi.fn(() => false),
}));

import jwt from 'jsonwebtoken';
import { authenticateSocket, type AuthedSocket } from './socketAuth';
import { isSessionActive } from '../lib/sessions';
import { shareState, verifyShareSession } from '../lib/shareAccess';
import { signAccessToken, signRefreshToken, signTwoFaToken } from '../lib/jwt';
import { env } from '../config/env';

const dbUser = { id: 7, email: 'artist@studio.com', role: 'ARTIST' as const };

/** Minimal socket: only the handshake matters for the check. */
const fakeSocket = (auth: Record<string, unknown> = {}, query: Record<string, unknown> = {}): AuthedSocket =>
  ({ handshake: { auth, query } }) as unknown as AuthedSocket;

const run = async (auth: Record<string, unknown>, query: Record<string, unknown> = {}) => {
  const socket = fakeSocket(auth, query);
  const next = vi.fn();
  await authenticateSocket(socket, next);
  const err = next.mock.calls[0]?.[0] as Error | undefined;
  return { socket, next, refuse: err !== undefined };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isSessionActive).mockResolvedValue(true);
  vi.mocked(shareState).mockReturnValue('ok');
  vi.mocked(verifyShareSession).mockReturnValue(false);
  db.user.findUnique.mockResolvedValue(dbUser);
  db.shareLink.findUnique.mockResolvedValue(null);
});

describe('authenticateSocket: access token', () => {
  it('accepts a valid access token and sets the user re-read from the database', async () => {
    const { socket, refuse } = await run({ token: signAccessToken({ ...dbUser, sid: 'abc' }) });
    expect(refuse).toBe(false);
    expect(socket.user).toEqual(dbUser);
  });

  // A1-01: a socket gives access to the same data as the API — internal comments, presigned URLs, notifications. It therefore closes under the same conditions.
  it('refuses a deactivated account', async () => {
    db.user.findUnique.mockResolvedValue({ ...dbUser, disabledAt: new Date() });
    const { socket, refuse } = await run({ token: signAccessToken({ ...dbUser, sid: 'abc' }) });
    expect(refuse).toBe(true);
    expect(socket.user).toBeUndefined();
  });

  // A3-02: without the `sid`, the session was only checked at handshake and a revocation left the websocket open for days. The periodic revalidation needs it.
  it('keeps the handshake session so that it can be replayed', async () => {
    const { socket } = await run({ token: signAccessToken({ ...dbUser, sid: 'abc' }) });
    expect(socket.authSid).toBe('abc');
  });

  /**
   * The heart of the fix: a socket gives access to the same data as an HTTP request. As long as it accepted an inherited token without `sid`, it remained the only door
   * of the product that no logout, no password change and no offboarding could close — refusing only on the HTTP side closed nothing.
   */
  it('refuses an inherited token without sid', async () => {
    const legacy = jwt.sign({ id: dbUser.id, email: dbUser.email, role: dbUser.role }, env.JWT_SECRET);
    const { socket, refuse } = await run({ token: legacy });
    expect(refuse).toBe(true);
    expect(socket.user).toBeUndefined();
  });

  it('does not consult the session for a token without sid', async () => {
    const legacy = jwt.sign({ id: dbUser.id, email: dbUser.email, role: dbUser.role }, env.JWT_SECRET);
    await run({ token: legacy });
    expect(isSessionActive).not.toHaveBeenCalled();
  });

  it('refuses a token whose session has been revoked', async () => {
    vi.mocked(isSessionActive).mockResolvedValue(false);
    const { refuse } = await run({ token: signAccessToken({ ...dbUser, sid: 'morte' }) });
    expect(refuse).toBe(true);
  });

  it('refuses a token whose account no longer exists', async () => {
    db.user.findUnique.mockResolvedValue(null);
    const { refuse } = await run({ token: signAccessToken({ ...dbUser, sid: 'abc' }) });
    expect(refuse).toBe(true);
  });

  // All the app's tokens share the JWT_SECRET: only the `kind` distinguishes them.
  it('refuses the other types of tokens signed with the same secret', async () => {
    expect((await run({ token: signRefreshToken({ ...dbUser, sid: 'abc' }) })).refuse).toBe(true);
    expect((await run({ token: signTwoFaToken(dbUser.id) })).refuse).toBe(true);
    const oidc = jwt.sign({ kind: 'oidc', state: 's', nonce: 'n' }, env.JWT_SECRET);
    expect((await run({ token: oidc })).refuse).toBe(true);
  });

  it('refuses a handshake without token', async () => {
    expect((await run({})).refuse).toBe(true);
    expect((await run({ token: '' })).refuse).toBe(true);
    expect((await run({ token: 42 })).refuse).toBe(true);
  });

  // A tab opened before the switch to `auth` still reconnects through the query.
  it('still accepts the token set in the query', async () => {
    const { socket, refuse } = await run({}, { token: signAccessToken({ ...dbUser, sid: 'abc' }) });
    expect(refuse).toBe(false);
    expect(socket.user).toEqual(dbUser);
  });
});

describe('authenticateSocket: client share link', () => {
  it('accepts an open link and keeps its project, without setting any user', async () => {
    db.shareLink.findUnique.mockResolvedValue({ id: 3, token: 'partage', projectId: 12, passwordHash: null });
    const { socket, refuse } = await run({ token: 'partage' });
    expect(refuse).toBe(false);
    expect(socket.shareProjectId).toBe(12);
    expect(socket.user).toBeUndefined();
  });

  it('refuses a revoked, expired or view-exhausted link', async () => {
    db.shareLink.findUnique.mockResolvedValue({ id: 3, token: 'partage', projectId: 12, passwordHash: null });
    vi.mocked(shareState).mockReturnValue('revoked');
    expect((await run({ token: 'partage' })).refuse).toBe(true);
  });

  // The link's token is in the URL: without this session, the password would be decorative.
  it('requires the share session when the link is password-protected', async () => {
    db.shareLink.findUnique.mockResolvedValue({ id: 3, token: 'partage', projectId: 12, passwordHash: 'h' });
    expect((await run({ token: 'partage' })).refuse).toBe(true);

    vi.mocked(verifyShareSession).mockReturnValue(true);
    const { socket, refuse } = await run({ token: 'partage' }, { shareAuth: 'session-de-partage' });
    expect(refuse).toBe(false);
    expect(socket.shareProjectId).toBe(12);
  });

  it('refuses a token that is neither an access token nor a known link', async () => {
    expect((await run({ token: 'nimportequoi' })).refuse).toBe(true);
  });
});
