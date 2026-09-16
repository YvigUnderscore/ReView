// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fakeIo, getAuthUser, isSessionActive, checkProjectAccess } = vi.hoisted(() => ({
  fakeIo: {
    connection: null as null | ((socket: unknown) => void),
    adapter: vi.fn(),
    use: vi.fn(),
    on: vi.fn(),
    to: vi.fn(() => ({ emit: vi.fn() })),
    local: { emit: vi.fn() },
    sockets: { sockets: new Map<string, unknown>() },
  },
  getAuthUser: vi.fn(),
  isSessionActive: vi.fn(),
  checkProjectAccess: vi.fn(),
}));

// `new SocketServer(...)` : le double doit être appelable avec `new`, d'où la fonction
// classique qui rend l'objet plutôt qu'une flèche.
vi.mock('socket.io', () => ({
  Server: vi.fn(function FakeServer() {
    return fakeIo;
  }),
}));
vi.mock('@socket.io/redis-adapter', () => ({ createAdapter: vi.fn(() => vi.fn()) }));
vi.mock('../lib/redis', () => ({
  createRedisClient: vi.fn(() => ({ quit: vi.fn(async () => undefined), disconnect: vi.fn() })),
  enableRedisTransport: vi.fn(),
  // Canal de révocation immédiate (A3-02) : ce fichier ne l'exerce pas, mais `initSocket`
  // s'y abonne — sans le double, la connexion ne s'ouvrirait même pas.
  subscribeRedis: vi.fn(),
}));
vi.mock('../lib/workerEvents', () => ({ subscribeWorkerEvents: vi.fn() }));
vi.mock('../lib/gracefulShutdown', () => ({
  registerShutdownTask: vi.fn(),
  SHUTDOWN_PHASE: { STOP_INTAKE: 10, DISCONNECT: 20 },
}));
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../lib/prisma', () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock('../lib/pipeline', () => ({ resolveProjectIdForMedia: vi.fn() }));
vi.mock('../lib/userView', () => ({ toPublicUser: vi.fn() }));
vi.mock('../lib/userCache', () => ({ getAuthUser }));
vi.mock('../lib/sessions', () => ({
  isSessionActive,
  SESSION_REVOCATION_CHANNEL: 'review:session-revoked',
  decodeSessionRevocation: vi.fn(() => []),
  markSessionsRevoked: vi.fn(),
}));
vi.mock('../middleware/rbac', () => ({ checkProjectAccess }));
vi.mock('./NotificationService', () => ({ notifyPlaylistLiveStarted: vi.fn() }));
vi.mock('./PresenceService', () => ({
  markOnline: vi.fn(),
  markOffline: vi.fn(),
  touch: vi.fn(),
  setPresenceBroadcaster: vi.fn(),
  joinReview: vi.fn(),
  leaveReview: vi.fn(),
  getReviewViewers: vi.fn(),
  startPresenceSync: vi.fn(),
}));
vi.mock('./LiveSessionService', () => ({
  parseLiveKey: vi.fn(),
  joinLive: vi.fn(),
  leaveLive: vi.fn(),
  handoffLive: vi.fn(),
  setCoHost: vi.fn(),
  canDriveLive: vi.fn(),
  isLiveDriver: vi.fn(),
  claimDrive: vi.fn(),
  getLiveState: vi.fn(),
  getLiveProjectId: vi.fn(),
  scheduleLiveLeave: vi.fn(),
  cancelLiveLeave: vi.fn(),
  startLiveSync: vi.fn(),
}));

import { Role } from '@prisma/client';
import { initSocket } from './SocketService';

type Listener = (...args: unknown[]) => unknown;

/** Socket de test : on n'en retient que ce que le serveur lui demande. */
const fakeSocket = () => {
  const listeners = new Map<string, Listener>();
  return {
    id: 'sock-1',
    user: { id: 7, email: 'sup@studio.com', role: Role.SUPERVISOR },
    authSid: 'sid-1',
    join: vi.fn(async () => undefined),
    leave: vi.fn(async () => undefined),
    to: vi.fn(() => ({ emit: vi.fn() })),
    disconnect: vi.fn(),
    // Garde de débit (A5-05) : posée en tête de `io.on('connection')`. Ce fichier ne
    // l'exerce pas — le middleware capturé n'est jamais rejoué, donc rien n'est filtré ici.
    use: vi.fn(),
    on: vi.fn((event: string, handler: Listener) => {
      listeners.set(event, handler);
    }),
    listeners,
  };
};

/** Branche le serveur, ouvre une connexion et rend le socket prêt à recevoir des événements. */
const connect = () => {
  fakeIo.on.mockImplementation((event: string, handler: (socket: unknown) => void) => {
    if (event === 'connection') fakeIo.connection = handler;
  });
  initSocket({} as never);
  const socket = fakeSocket();
  fakeIo.connection!(socket);
  return socket;
};

beforeEach(() => {
  vi.clearAllMocks();
  isSessionActive.mockResolvedValue(true);
  getAuthUser.mockResolvedValue({
    id: 7,
    email: 'sup@studio.com',
    role: Role.SUPERVISOR,
    disabledAt: null,
  });
  checkProjectAccess.mockResolvedValue(true);
});

/**
 * A3-02, le scénario de l'audit : un superviseur quitte le studio, l'admin le rétrograde en
 * CLIENT puis révoque ses sessions. Ses requêtes HTTP tombent en 401 sous trente secondes.
 * Son onglet resté ouvert, lui, gardait sa websocket — et `join_project` lui accordait
 * n'importe quel projet, parce que le contrôle lisait le rôle FIGÉ au handshake et que
 * `resolveProjectAccess` accorde un accès global à ADMIN comme à SUPERVISOR.
 */
describe('join_project — le rôle n’est plus celui du handshake', () => {
  const joinProject = async (socket: ReturnType<typeof fakeSocket>, projectId: number) => {
    await socket.listeners.get('join_project')!(projectId);
  };

  it('rejoint la salle d’un projet accessible', async () => {
    const socket = connect();
    await joinProject(socket, 42);
    expect(socket.join).toHaveBeenCalledWith('project_42');
  });

  it('contrôle l’accès avec le rôle COURANT, pas celui du jeton', async () => {
    const socket = connect();
    getAuthUser.mockResolvedValue({
      id: 7,
      email: 'sup@studio.com',
      role: Role.CLIENT,
      disabledAt: null,
    });
    await joinProject(socket, 42);
    expect(checkProjectAccess).toHaveBeenCalledWith(7, Role.CLIENT, 42);
  });

  it('ferme la connexion quand la session a été révoquée', async () => {
    const socket = connect();
    isSessionActive.mockResolvedValue(false);
    await joinProject(socket, 42);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    // `socket.join('user_7')` a lieu à la connexion : c'est la salle du projet qui ne doit
    // pas être rejointe.
    expect(socket.join).not.toHaveBeenCalledWith('project_42');
    expect(checkProjectAccess).not.toHaveBeenCalled();
  });

  it('ferme la connexion d’un compte désactivé', async () => {
    const socket = connect();
    getAuthUser.mockResolvedValue({
      id: 7,
      email: 'sup@studio.com',
      role: Role.SUPERVISOR,
      disabledAt: new Date(),
    });
    await joinProject(socket, 42);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalledWith('project_42');
  });
});
