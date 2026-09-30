// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { fakeIo, getAuthUser, isSessionActive, checkProjectAccess, subscribeRedis, markSessionsRevoked } =
  vi.hoisted(() => ({
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
    subscribeRedis: vi.fn(),
    markSessionsRevoked: vi.fn(),
  }));

vi.mock('socket.io', () => ({
  Server: vi.fn(function FakeServer() {
    return fakeIo;
  }),
}));
vi.mock('@socket.io/redis-adapter', () => ({ createAdapter: vi.fn(() => vi.fn()) }));
vi.mock('../lib/redis', () => ({
  createRedisClient: vi.fn(() => ({ quit: vi.fn(async () => undefined), disconnect: vi.fn() })),
  enableRedisTransport: vi.fn(),
  subscribeRedis,
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
// `socketRateLimit` n'est PAS doublé : c'est précisément le branchement du vrai module
// qu'on veut constater. Un double ici rendrait le test vert sans limiteur.
vi.mock('../lib/sessions', async (importOriginal) => {
  // Le décodeur est celui de production (contrat du canal) ; seuls les effets sont doublés.
  const real = await importOriginal<typeof import('../lib/sessions')>();
  return {
    SESSION_REVOCATION_CHANNEL: real.SESSION_REVOCATION_CHANNEL,
    encodeSessionRevocation: real.encodeSessionRevocation,
    decodeSessionRevocation: real.decodeSessionRevocation,
    isSessionActive,
    markSessionsRevoked,
  };
});
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
import { encodeSessionRevocation, SESSION_REVOCATION_CHANNEL } from '../lib/sessions';
import { initSocket, disconnectRevokedSockets, type AuthedSocket } from './SocketService';

type Listener = (...args: unknown[]) => unknown;
type Middleware = (packet: unknown[], next: (err?: Error) => void) => void;

/**
 * Socket de test. `use` capture le middleware de paquets : c'est par là que passe la garde
 * de débit, et c'est ce qu'on veut pouvoir faire tourner sans serveur Socket.io réel.
 */
const fakeSocket = (id = 'sock-1', authSid = 'sid-1') => {
  const listeners = new Map<string, Listener>();
  const middlewares: Middleware[] = [];
  return {
    id,
    user: { id: 7, email: 'sup@studio.com', role: Role.SUPERVISOR },
    authSid,
    join: vi.fn(async () => undefined),
    leave: vi.fn(async () => undefined),
    to: vi.fn(() => ({ emit: vi.fn() })),
    disconnect: vi.fn(),
    use: vi.fn((fn: Middleware) => {
      middlewares.push(fn);
    }),
    on: vi.fn((event: string, handler: Listener) => {
      listeners.set(event, handler);
    }),
    listeners,
    middlewares,
    /**
     * Rejoue un paquet entrant à travers la chaîne de middlewares. Rend vrai si le paquet a
     * atteint le bout — c'est-à-dire si le gestionnaire `socket.on` aurait été appelé.
     */
    emit(event: string, ...args: unknown[]): boolean {
      for (const mw of middlewares) {
        let passed = false;
        mw([event, ...args], () => {
          passed = true;
        });
        if (!passed) return false;
      }
      return true;
    },
  };
};

const connect = (id?: string, authSid?: string) => {
  fakeIo.on.mockImplementation((event: string, handler: (socket: unknown) => void) => {
    if (event === 'connection') fakeIo.connection = handler;
  });
  initSocket({} as never);
  const socket = fakeSocket(id, authSid);
  fakeIo.connection!(socket);
  return socket;
};

beforeEach(() => {
  vi.clearAllMocks();
  fakeIo.sockets.sockets.clear();
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
 * A5-05 — le module `lib/socketRateLimit` existait, avec ses tests, mais personne ne
 * l'appelait : la surface Socket.io n'avait AUCUNE limite, et l'audit l'a re-mesuré en
 * direct (160 500 événements en 5 s sur une seule websocket, sans déconnexion). Un correctif
 * non branché est un correctif non fait — ce bloc constate le branchement, pas l'algorithme
 * (celui-là a ses propres tests dans `lib/socketRateLimit.test.ts`).
 */
describe('io.on(connection) — la garde de débit est réellement posée', () => {
  it('installe un middleware de paquets sur chaque connexion acceptée', () => {
    const socket = connect();
    expect(socket.use).toHaveBeenCalled();
    expect(socket.middlewares).toHaveLength(1);
  });

  it('arrête une boucle de `join_review` AVANT le gestionnaire (donc avant Postgres)', () => {
    const socket = connect();
    // 240 jetons / 12 par join = 20 passages, puis plus rien tant que le seau ne recharge pas.
    for (let i = 0; i < 20; i += 1) expect(socket.emit('join_review', i)).toBe(true);
    expect(socket.emit('join_review', 21)).toBe(false);
  });

  it('ferme la connexion sur un dépassement soutenu', () => {
    const socket = connect();
    for (let i = 0; i < 600; i += 1) socket.emit('join_review', i);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  /**
   * Le contre-test qui compte : une limite qui coupe le pilote d'une projection client serait
   * désarmée à la première plainte. On rejoue dix secondes du régime le plus bavard relevé
   * côté front — diffusion périodique 30 Hz, curseur ~20 Hz, frappe soutenue — et rien ne
   * doit tomber.
   */
  it('laisse passer dix secondes de pilote de dailies (30 Hz + curseur + frappe)', () => {
    // Seule l'horloge est feinte : `initSocket` pose un `setInterval(...).unref()`, qu'un
    // faux minuteur remplacerait par un identifiant sans `unref`.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    const socket = connect();
    let dropped = 0;
    for (let ms = 0; ms < 10_000; ms += 1) {
      vi.setSystemTime(ms);
      // ~30 Hz : diffusion périodique du pilote (`syncHz` borné à 30 côté front).
      if (ms % 33 === 0 && !socket.emit('live:sync', 'k', { mediaId: 1, t: 12.5, playing: true }))
        dropped += 1;
      // 20 Hz : curseur partagé (`POINTER_INTERVAL_MS = 50`), sur le même canal.
      if (
        ms % 50 === 0 &&
        !socket.emit('live:sync', 'k', { mediaId: 1, pointer: { userId: 7, x: 0.4, y: 0.6 } })
      )
        dropped += 1;
      // 10 Hz : `activity` est émis à chaque frappe, sans étranglement côté client.
      if (ms % 100 === 0 && !socket.emit('activity')) dropped += 1;
    }
    expect(dropped).toBe(0);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });
});

/**
 * A3-02, volet immédiat — la revalidation périodique laissait jusqu'à une minute de sursis
 * à l'onglet d'un partant : une minute de commentaires internes et d'URL présignées.
 */
describe('révocation immédiate — le canal est abonné et coupe les bonnes connexions', () => {
  const deliver = (sids: string[]) => {
    const handler = subscribeRedis.mock.calls.find(
      (c: unknown[]) => c[0] === SESSION_REVOCATION_CHANNEL,
    )?.[1] as ((raw: string) => void) | undefined;
    expect(handler, 'aucun abonnement au canal de révocation').toBeDefined();
    handler!(encodeSessionRevocation(sids));
  };

  it('abonne le service au canal de révocation', () => {
    initSocket({} as never);
    expect(subscribeRedis).toHaveBeenCalledWith(SESSION_REVOCATION_CHANNEL, expect.any(Function));
  });

  it('ferme la connexion du sid révoqué et épargne les autres', () => {
    connect();
    const revoked = fakeSocket('sock-a', 'sid-morte');
    const kept = fakeSocket('sock-b', 'sid-vivante');
    fakeIo.sockets.sockets.set('a', revoked);
    fakeIo.sockets.sockets.set('b', kept);

    deliver(['sid-morte']);

    expect(revoked.disconnect).toHaveBeenCalledWith(true);
    expect(kept.disconnect).not.toHaveBeenCalled();
  });

  /**
   * Fermer le socket sans tomber le cache serait cosmétique : `isSessionActive` répondrait
   * encore « vivante » pendant trente secondes et l'API rouvrirait la porte.
   */
  it('invalide aussi le cache de validité de cette réplique', () => {
    connect();
    deliver(['sid-morte']);
    expect(markSessionsRevoked).toHaveBeenCalledWith(['sid-morte']);
  });

  it('ignore un message illisible sans rien fermer', () => {
    connect();
    const victime = fakeSocket('sock-a', 'sid-1');
    fakeIo.sockets.sockets.set('a', victime);
    const handler = subscribeRedis.mock.calls.find(
      (c: unknown[]) => c[0] === SESSION_REVOCATION_CHANNEL,
    )![1] as (raw: string) => void;

    expect(() => handler('{pas du json')).not.toThrow();
    expect(victime.disconnect).not.toHaveBeenCalled();
    expect(markSessionsRevoked).not.toHaveBeenCalled();
  });
});

describe('disconnectRevokedSockets', () => {
  const serverOf = (...sockets: unknown[]) =>
    ({ sockets: { sockets: new Map(sockets.map((s, i) => [String(i), s])) } }) as never;

  it('rapproche sur le sid, pas sur l’utilisateur (la session épargnée reste ouverte)', () => {
    // Même compte, deux onglets : « révoquer mes autres sessions » ne doit pas déconnecter
    // l'auteur de l'action — sa session n'est pas dans la liste publiée.
    const autre = fakeSocket('sock-a', 'sid-autre');
    const courante = fakeSocket('sock-b', 'sid-courante');

    expect(disconnectRevokedSockets(serverOf(autre, courante), ['sid-autre'])).toBe(1);
    expect(autre.disconnect).toHaveBeenCalledWith(true);
    expect(courante.disconnect).not.toHaveBeenCalled();
  });

  // Un invité de partage n'a pas de session : rien à rapprocher, et surtout rien à couper.
  it('laisse tranquille une connexion sans session', () => {
    const invite = { ...fakeSocket('sock-c'), authSid: undefined } as unknown as AuthedSocket;
    expect(disconnectRevokedSockets(serverOf(invite), ['sid-morte'])).toBe(0);
    expect(invite.disconnect).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.useRealTimers();
});
