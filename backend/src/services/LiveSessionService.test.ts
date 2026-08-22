// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { __redisTesting, enableRedisTransport } from '../lib/redis';
import { createFakeRedis, type FakeRedis } from '../lib/redisFake';
import {
  parseLiveKey,
  joinLive,
  leaveLive,
  handoffLive,
  setCoHost,
  canDriveLive,
  isLiveDriver,
  claimDrive,
  getLiveState,
  getLiveProjectId,
  listLiveSessions,
  scheduleLiveLeave,
  cancelLiveLeave,
  resetLiveSessions,
  startLiveSync,
  LIVE_PARTICIPANT_TTL_MS,
  __liveTesting,
  type LiveParticipant,
} from './LiveSessionService';

const p = (id: number): LiveParticipant => ({
  id,
  displayName: `User ${id}`,
  initials: `U${id}`,
  avatarUrl: null,
});

let redis: FakeRedis;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-22T10:00:00Z'));
  __redisTesting.reset();
  resetLiveSessions();
  redis = createFakeRedis();
  __redisTesting.setClient(redis);
  enableRedisTransport();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Avance l'horloge sans déclencher de minuterie. */
const advance = (ms: number): void => {
  vi.setSystemTime(new Date(Date.now() + ms));
};

/** Simule un redémarrage (ou une seconde réplique) : état local vide, Redis intact. */
async function asFreshReplica(): Promise<void> {
  resetLiveSessions();
  await __liveTesting.reloadAll();
}

describe('parseLiveKey (33.B)', () => {
  it('accepte media:<id> et playlist:<id>', () => {
    expect(parseLiveKey('media:12')).toEqual({ type: 'media', id: 12 });
    expect(parseLiveKey('playlist:3')).toEqual({ type: 'playlist', id: 3 });
  });
  it('rejette les clés malformées', () => {
    for (const bad of ['media:', 'media:0', 'media:-1', 'shot:4', 'media:1e3', 42, null, 'media:1;drop'])
      expect(parseLiveKey(bad)).toBeNull();
  });
});

describe('joinLive / leaveLive (33.B)', () => {
  it('le premier arrivant devient pilote ET driver, les suivants spectateurs', async () => {
    const s1 = await joinLive('media:1', p(10));
    expect(s1.state.pilotId).toBe(10);
    expect(s1.state.driverId).toBe(10);
    expect(s1.created).toBe(true);
    const s2 = await joinLive('media:1', p(20));
    expect(s2.state.pilotId).toBe(10);
    expect(s2.created).toBe(false);
    expect(s2.state.participants.map((x) => x.id)).toEqual([10, 20]);
  });

  it('re-join du même utilisateur : idempotent (pas de doublon)', async () => {
    await joinLive('media:1', p(10));
    const s = await joinLive('media:1', p(10));
    expect(s.state.participants).toHaveLength(1);
  });

  it('départ du pilote : la main passe au premier co-pilote sinon au plus ancien', async () => {
    await joinLive('media:1', p(10));
    await joinLive('media:1', p(20));
    await joinLive('media:1', p(30));
    await setCoHost('media:1', 10, 30, true);
    const s = await leaveLive('media:1', 10);
    expect(s?.pilotId).toBe(30);
    expect(s?.coHostIds).toEqual([]);
    expect(s?.driverId).toBe(30);
  });

  it('dernier départ : la session est fermée', async () => {
    await joinLive('media:1', p(10));
    expect(await leaveLive('media:1', 10)).toBeNull();
    expect(getLiveState('media:1')).toBeNull();
  });

  it('leave d’un non-participant : no-op (null), la session survit', async () => {
    await joinLive('media:1', p(10));
    expect(await leaveLive('media:1', 99)).toBeNull();
    expect(getLiveState('media:1')?.participants).toHaveLength(1);
  });
});

describe('handoffLive (33.B)', () => {
  beforeEach(async () => {
    await joinLive('media:1', p(10));
    await joinLive('media:1', p(20));
  });

  it('le pilote donne la main à un participant présent (driver suit)', async () => {
    const s = await handoffLive('media:1', 10, 20);
    expect(s?.pilotId).toBe(20);
    expect(s?.driverId).toBe(20);
  });

  it('refusé si l’émetteur n’est pas pilote ou si la cible est absente', async () => {
    expect(await handoffLive('media:1', 20, 10)).toBeNull();
    expect(await handoffLive('media:1', 10, 99)).toBeNull();
    expect(getLiveState('media:1')?.pilotId).toBe(10);
  });
});

describe('co-pilotes & driver (retours CP-HUMAIN 33)', () => {
  beforeEach(async () => {
    await joinLive('media:1', p(10));
    await joinLive('media:1', p(20));
    await joinLive('media:1', p(30));
  });

  it('seul le pilote nomme/retire un co-pilote (cible présente, pas lui-même)', async () => {
    expect(await setCoHost('media:1', 20, 30, true)).toBeNull();
    expect(await setCoHost('media:1', 10, 10, true)).toBeNull();
    expect(await setCoHost('media:1', 10, 99, true)).toBeNull();
    const s = await setCoHost('media:1', 10, 20, true);
    expect(s?.coHostIds).toEqual([20]);
    expect(canDriveLive('media:1', 20)).toBe(true);
    expect(canDriveLive('media:1', 30)).toBe(false);
  });

  it('claimDrive : un co-pilote qui interagit devient driver ; un spectateur non', async () => {
    await setCoHost('media:1', 10, 20, true);
    expect(await claimDrive('media:1', 30)).toBeNull();
    const s = await claimDrive('media:1', 20);
    expect(s?.driverId).toBe(20);
    expect(isLiveDriver('media:1', 20)).toBe(true);
    // Déjà driver → pas de nouvel état (pas de re-broadcast).
    expect(await claimDrive('media:1', 20)).toBeNull();
    // Le pilote peut reprendre la main en interagissant.
    expect((await claimDrive('media:1', 10))?.driverId).toBe(10);
  });

  it('retirer le co-pilotage du driver → la main revient au pilote', async () => {
    await setCoHost('media:1', 10, 20, true);
    await claimDrive('media:1', 20);
    const s = await setCoHost('media:1', 10, 20, false);
    expect(s?.coHostIds).toEqual([]);
    expect(s?.driverId).toBe(10);
  });

  it('départ du driver co-pilote → la main revient au pilote', async () => {
    await setCoHost('media:1', 10, 20, true);
    await claimDrive('media:1', 20);
    const s = await leaveLive('media:1', 20);
    expect(s?.driverId).toBe(10);
  });

  // Chemin chaud : `live:sync` repasse ici plusieurs fois par seconde. Un aller-retour
  // Redis à chaque trame saccaderait la lecture pour toute la salle.
  it('claimDrive sur un driver déjà en place ne touche pas Redis', async () => {
    await claimDrive('media:1', 20);
    const before = redis.commandCounts.get('SET') ?? 0;
    expect(await claimDrive('media:1', 10)).toBeNull();
    expect(redis.commandCounts.get('SET') ?? 0).toBe(before);
  });
});

describe('méta & liste des sessions par projet (retours 33 — badges LIVE)', () => {
  it('la méta est posée à la création et conservée aux joins suivants', async () => {
    await joinLive('media:1', p(10), { projectId: 7, mediaId: 1, versionId: 3 });
    await joinLive('media:1', p(20), { projectId: 99, mediaId: 1 }); // ignorée (déjà posée)
    expect(getLiveProjectId('media:1')).toBe(7);
    const sessions = listLiveSessions(7);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      key: 'media:1',
      mediaId: 1,
      versionId: 3,
      participantCount: 2,
    });
    expect(sessions[0]?.pilot?.id).toBe(10);
  });

  it('ne liste que le projet demandé ; session fermée → disparaît', async () => {
    await joinLive('media:1', p(10), { projectId: 7, mediaId: 1 });
    await joinLive('playlist:2', p(20), { projectId: 8, playlistId: 2 });
    expect(listLiveSessions(7).map((s) => s.key)).toEqual(['media:1']);
    await leaveLive('media:1', 10);
    expect(listLiveSessions(7)).toEqual([]);
    expect(getLiveProjectId('media:1')).toBeNull();
  });
});

describe('grâce de déconnexion (retours 33 — F5 garde le rôle de pilote)', () => {
  it('re-join pendant la grâce : le départ est annulé, le pilote garde la main', async () => {
    await joinLive('media:1', p(10));
    await joinLive('media:1', p(20));
    const onLeft = vi.fn();
    scheduleLiveLeave('media:1', 10, onLeft, 5000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(cancelLiveLeave('media:1', 10)).toBe(true);
    const s = await joinLive('media:1', p(10));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onLeft).not.toHaveBeenCalled();
    expect(s.state.pilotId).toBe(10);
    expect(getLiveState('media:1')?.pilotId).toBe(10);
  });

  it('grâce échue : le départ est appliqué et notifié (main transmise)', async () => {
    await joinLive('media:1', p(10));
    await joinLive('media:1', p(20));
    const onLeft = vi.fn();
    scheduleLiveLeave('media:1', 10, onLeft, 5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(onLeft).toHaveBeenCalledOnce();
    expect(onLeft.mock.calls[0]?.[0]?.pilotId).toBe(20);
    expect(cancelLiveLeave('media:1', 10)).toBe(false);
  });

  it('reprogrammation : un second schedule remplace le premier (un seul départ)', async () => {
    await joinLive('media:1', p(10));
    const onLeft = vi.fn();
    scheduleLiveLeave('media:1', 10, onLeft, 5000);
    await vi.advanceTimersByTimeAsync(3000);
    scheduleLiveLeave('media:1', 10, onLeft, 5000);
    await vi.advanceTimersByTimeAsync(4000);
    expect(onLeft).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onLeft).toHaveBeenCalledOnce();
  });
});

describe('état partagé : redémarrage, seconde réplique, baux', () => {
  it('une salle survit au redémarrage du serveur', async () => {
    await joinLive('playlist:9', p(10), { projectId: 4, playlistId: 9 });
    await joinLive('playlist:9', p(20), { projectId: 4, playlistId: 9 });
    await setCoHost('playlist:9', 10, 20, true);

    await asFreshReplica();

    const state = getLiveState('playlist:9');
    expect(state?.pilotId).toBe(10);
    expect(state?.coHostIds).toEqual([20]);
    expect(state?.participants.map((x) => x.id)).toEqual([10, 20]);
    expect(listLiveSessions(4).map((s) => s.key)).toEqual(['playlist:9']);
  });

  it('un join venu d’une autre réplique n’est pas déclaré « créé » deux fois', async () => {
    const first = await joinLive('media:5', p(10), { projectId: 1, mediaId: 5 });
    expect(first.created).toBe(true);
    // Réplique neuve : son miroir est vide, mais Redis fait foi.
    await asFreshReplica();
    resetLiveSessions();
    const second = await joinLive('media:5', p(20), { projectId: 1, mediaId: 5 });
    expect(second.created).toBe(false);
    expect(second.state.pilotId).toBe(10);
  });

  // Une réplique tuée ne peut plus retirer ses participants : sans bail, la salle resterait
  // peuplée de fantômes, pilote compris — donc impilotable.
  it('un participant dont le bail a expiré est retiré et la main passe', async () => {
    await joinLive('media:6', p(10), { projectId: 2, mediaId: 6 });
    await joinLive('media:6', p(20), { projectId: 2, mediaId: 6 });
    advance(LIVE_PARTICIPANT_TTL_MS + 1);
    // Un seul des deux se manifeste : l'autre était porté par la réplique disparue.
    const state = (await joinLive('media:6', p(20), { projectId: 2, mediaId: 6 })).state;
    expect(state.participants.map((x) => x.id)).toEqual([20]);
    expect(state.pilotId).toBe(20);
  });

  it('le battement de cœur renouvelle le bail des participants de ce process', async () => {
    await joinLive('media:7', p(10));
    advance(LIVE_PARTICIPANT_TTL_MS - 1_000);
    await __redisTesting.runHeartbeat();
    advance(2_000);
    await __liveTesting.reloadAll();
    expect(getLiveState('media:7')?.participants.map((x) => x.id)).toEqual([10]);
  });

  it('une salle entièrement expirée est effacée de Redis et de l’index', async () => {
    await joinLive('media:8', p(10), { projectId: 3, mediaId: 8 });
    resetLiveSessions(); // la réplique qui la portait disparaît
    advance(LIVE_PARTICIPANT_TTL_MS + 1);
    await __liveTesting.reloadAll();
    expect(getLiveState('media:8')).toBeNull();
    expect(await redis.call('SMEMBERS', 'review:live:index')).toEqual([]);
    expect(await redis.call('GET', 'review:live:s:media:8')).toBeNull();
  });

  it('amorce les badges LIVE au démarrage, sans attendre un join local', async () => {
    await joinLive('media:11', p(10), { projectId: 5, mediaId: 11 });
    resetLiveSessions();
    expect(listLiveSessions(5)).toEqual([]);
    startLiveSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(listLiveSessions(5).map((s) => s.key)).toEqual(['media:11']);
  });

  it('publie la clé touchée pour que les autres répliques se resynchronisent', async () => {
    await joinLive('media:9', p(10));
    expect(redis.published).toContainEqual({ channel: 'review:live', payload: 'media:9' });
  });

  it('Redis muet : la salle se dégrade sans jeter ni bloquer', async () => {
    redis.failing = true;
    const { state, created } = await joinLive('media:10', p(10));
    expect(created).toBe(false);
    expect(state.participants.map((x) => x.id)).toEqual([10]);
    expect(await leaveLive('media:10', 10)).toBeNull();
  });
});
