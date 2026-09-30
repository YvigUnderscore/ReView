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

/** Socket minimal : seul le handshake compte pour la vérification. */
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

describe('authenticateSocket — jeton d’accès', () => {
  it('accepte un jeton d’accès valide et pose l’utilisateur relu en base', async () => {
    const { socket, refuse } = await run({ token: signAccessToken({ ...dbUser, sid: 'abc' }) });
    expect(refuse).toBe(false);
    expect(socket.user).toEqual(dbUser);
  });

  // A1-01 : un socket donne accès aux mêmes données que l'API — commentaires internes,
  // URLs présignées, notifications. Il se ferme donc sur les mêmes conditions.
  it('refuse un compte désactivé', async () => {
    db.user.findUnique.mockResolvedValue({ ...dbUser, disabledAt: new Date() });
    const { socket, refuse } = await run({ token: signAccessToken({ ...dbUser, sid: 'abc' }) });
    expect(refuse).toBe(true);
    expect(socket.user).toBeUndefined();
  });

  // A3-02 : sans le `sid`, la session n'était vérifiée qu'au handshake et une révocation
  // laissait la websocket ouverte pour des jours. La revalidation périodique en a besoin.
  it('retient la session du handshake pour pouvoir la rejouer', async () => {
    const { socket } = await run({ token: signAccessToken({ ...dbUser, sid: 'abc' }) });
    expect(socket.authSid).toBe('abc');
  });

  /**
   * Le cœur du correctif : un socket donne accès aux mêmes données qu'une requête HTTP.
   * Tant qu'il acceptait un jeton hérité sans `sid`, il restait la seule porte du produit
   * qu'aucune déconnexion, aucun changement de mot de passe et aucun offboarding ne
   * pouvait fermer — refuser côté HTTP seulement ne fermait rien.
   */
  it('refuse un jeton hérité sans sid', async () => {
    const legacy = jwt.sign({ id: dbUser.id, email: dbUser.email, role: dbUser.role }, env.JWT_SECRET);
    const { socket, refuse } = await run({ token: legacy });
    expect(refuse).toBe(true);
    expect(socket.user).toBeUndefined();
  });

  it('ne consulte pas la session pour un jeton sans sid', async () => {
    const legacy = jwt.sign({ id: dbUser.id, email: dbUser.email, role: dbUser.role }, env.JWT_SECRET);
    await run({ token: legacy });
    expect(isSessionActive).not.toHaveBeenCalled();
  });

  it('refuse un jeton dont la session a été révoquée', async () => {
    vi.mocked(isSessionActive).mockResolvedValue(false);
    const { refuse } = await run({ token: signAccessToken({ ...dbUser, sid: 'morte' }) });
    expect(refuse).toBe(true);
  });

  it('refuse un jeton dont le compte n’existe plus', async () => {
    db.user.findUnique.mockResolvedValue(null);
    const { refuse } = await run({ token: signAccessToken({ ...dbUser, sid: 'abc' }) });
    expect(refuse).toBe(true);
  });

  // Tous les jetons de l'app partagent le JWT_SECRET : seul le `kind` les distingue.
  it('refuse les autres types de jetons signés du même secret', async () => {
    expect((await run({ token: signRefreshToken({ ...dbUser, sid: 'abc' }) })).refuse).toBe(true);
    expect((await run({ token: signTwoFaToken(dbUser.id) })).refuse).toBe(true);
    const oidc = jwt.sign({ kind: 'oidc', state: 's', nonce: 'n' }, env.JWT_SECRET);
    expect((await run({ token: oidc })).refuse).toBe(true);
  });

  it('refuse un handshake sans jeton', async () => {
    expect((await run({})).refuse).toBe(true);
    expect((await run({ token: '' })).refuse).toBe(true);
    expect((await run({ token: 42 })).refuse).toBe(true);
  });

  // L'onglet ouvert avant la bascule vers `auth` se reconnecte encore par la query.
  it('accepte encore le jeton posé en query', async () => {
    const { socket, refuse } = await run({}, { token: signAccessToken({ ...dbUser, sid: 'abc' }) });
    expect(refuse).toBe(false);
    expect(socket.user).toEqual(dbUser);
  });
});

describe('authenticateSocket — lien de partage client', () => {
  it('accepte un lien ouvert et retient son projet, sans poser d’utilisateur', async () => {
    db.shareLink.findUnique.mockResolvedValue({ id: 3, token: 'partage', projectId: 12, passwordHash: null });
    const { socket, refuse } = await run({ token: 'partage' });
    expect(refuse).toBe(false);
    expect(socket.shareProjectId).toBe(12);
    expect(socket.user).toBeUndefined();
  });

  it('refuse un lien révoqué, expiré ou à bout de vues', async () => {
    db.shareLink.findUnique.mockResolvedValue({ id: 3, token: 'partage', projectId: 12, passwordHash: null });
    vi.mocked(shareState).mockReturnValue('revoked');
    expect((await run({ token: 'partage' })).refuse).toBe(true);
  });

  // Le token du lien est dans l'URL : sans cette session, le mot de passe serait décoratif.
  it('exige la session de partage quand le lien est protégé par mot de passe', async () => {
    db.shareLink.findUnique.mockResolvedValue({ id: 3, token: 'partage', projectId: 12, passwordHash: 'h' });
    expect((await run({ token: 'partage' })).refuse).toBe(true);

    vi.mocked(verifyShareSession).mockReturnValue(true);
    const { socket, refuse } = await run({ token: 'partage' }, { shareAuth: 'session-de-partage' });
    expect(refuse).toBe(false);
    expect(socket.shareProjectId).toBe(12);
  });

  it('refuse un jeton qui n’est ni un accès ni un lien connu', async () => {
    expect((await run({ token: 'nimportequoi' })).refuse).toBe(true);
  });
});
