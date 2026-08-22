// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { update } = vi.hoisted(() => ({ update: vi.fn().mockResolvedValue({}) }));
vi.mock('../lib/prisma', () => ({ prisma: { user: { update } } }));

import { __redisTesting, enableRedisTransport } from '../lib/redis';
import { createFakeRedis, type FakeRedis } from '../lib/redisFake';
import {
  __resetPresence,
  getOnlineUserIds,
  getReviewViewers,
  joinReview,
  leaveReview,
  markOffline,
  markOnline,
  setPresenceBroadcaster,
  startPresenceSync,
  PRESENCE_TTL_MS,
  type ReviewViewer,
} from './PresenceService';

const viewer = (id: number, name = `User ${id}`): ReviewViewer => ({
  id,
  displayName: name,
  initials: name.slice(0, 2).toUpperCase(),
  avatarUrl: null,
});

let redis: FakeRedis;
let broadcasts: number[][];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-22T10:00:00Z'));
  update.mockClear();
  __redisTesting.reset();
  __resetPresence();
  redis = createFakeRedis();
  __redisTesting.setClient(redis);
  enableRedisTransport();
  broadcasts = [];
  setPresenceBroadcaster((ids) => broadcasts.push(ids));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Avance l'horloge sans déclencher de minuterie (seul `Date` est simulé). */
const advance = (ms: number): void => {
  vi.setSystemTime(new Date(Date.now() + ms));
};

describe('présence en ligne', () => {
  it('compte les onglets : en ligne au premier, hors ligne au dernier', async () => {
    await markOnline(1, 'ongletA');
    expect(getOnlineUserIds()).toEqual([1]);
    await markOnline(1, 'ongletB');
    expect(getOnlineUserIds()).toEqual([1]);
    await markOffline(1, 'ongletA');
    expect(getOnlineUserIds()).toEqual([1]);
    await markOffline(1, 'ongletB');
    expect(getOnlineUserIds()).toEqual([]);
  });

  it('ne diffuse que sur changement effectif de la liste', async () => {
    await markOnline(1, 'a');
    await markOnline(1, 'b');
    await markOnline(2, 'c');
    expect(broadcasts).toEqual([[1], [1, 2]]);
  });

  it('écrit lastSeenAt à la première connexion et à la dernière déconnexion, pas entre', async () => {
    await markOnline(1, 'a');
    expect(update).toHaveBeenCalledOnce();
    await markOnline(1, 'b');
    expect(update).toHaveBeenCalledOnce();
    await markOffline(1, 'a');
    expect(update).toHaveBeenCalledOnce();
    await markOffline(1, 'b');
    expect(update).toHaveBeenCalledTimes(2);
  });

  // Une réplique tuée ne peut plus retirer ses entrées : sans bail, ses utilisateurs
  // resteraient « en ligne » indéfiniment pour tout le studio.
  it('une entrée dont le bail a expiré disparaît de la liste', async () => {
    await markOnline(1, 'a');
    await markOnline(2, 'b');
    expect(getOnlineUserIds()).toEqual([1, 2]);
    advance(PRESENCE_TTL_MS + 1);
    await __redisTesting.runHeartbeat();
    // Seules les connexions de ce process ont vu leur bail renouvelé.
    expect(getOnlineUserIds()).toEqual([1, 2]);
  });

  it('l’entrée d’une réplique disparue expire, celle de ce process est renouvelée', async () => {
    await markOnline(1, 'local');
    // Entrée écrite « par une autre réplique », avec un bail qui va échoir.
    await redis.call('ZADD', 'review:presence:online', Date.now() + 1_000, '99|distant');
    await __redisTesting.runHeartbeat();
    expect(getOnlineUserIds()).toEqual([1, 99]);
    advance(2_000);
    await __redisTesting.runHeartbeat();
    expect(getOnlineUserIds()).toEqual([1]);
  });

  it('la notification d’une autre réplique rafraîchit le miroir local', async () => {
    await markOnline(1, 'local');
    await redis.call('ZADD', 'review:presence:online', Date.now() + PRESENCE_TTL_MS, '7|ailleurs');
    __redisTesting.deliver('review:presence:online', 'online');
    await vi.waitFor(() => expect(getOnlineUserIds()).toEqual([1, 7]));
  });

  // Une réplique qui ne porte aucun socket ne se serait jamais réveillée : la page
  // d'administration qu'elle sert aurait annoncé « personne en ligne ».
  it('amorce la synchronisation au démarrage, sans socket local', async () => {
    await redis.call('ZADD', 'review:presence:online', Date.now() + PRESENCE_TTL_MS, '4|ailleurs');
    expect(getOnlineUserIds()).toEqual([]);
    startPresenceSync();
    await vi.waitFor(() => expect(getOnlineUserIds()).toEqual([4]));
  });

  it('publie sur le canal pour que les autres répliques diffusent aussi', async () => {
    await markOnline(1, 'a');
    expect(redis.published).toContainEqual({ channel: 'review:presence:online', payload: 'online' });
  });
});

describe('présence par review', () => {
  it('ajoute puis retire un spectateur', async () => {
    expect((await joinReview(1001, viewer(1), 'c1')).map((v) => v.id)).toEqual([1]);
    expect((await joinReview(1001, viewer(2), 'c2')).map((v) => v.id)).toEqual([1, 2]);
    expect((await leaveReview(1001, 1, 'c1')).map((v) => v.id)).toEqual([2]);
    expect(await leaveReview(1001, 2, 'c2')).toEqual([]);
    expect(await getReviewViewers(1001)).toEqual([]);
  });

  it('compte les onglets multiples : ne retire qu’au dernier leave', async () => {
    await joinReview(1002, viewer(5), 'c1');
    await joinReview(1002, viewer(5), 'c2');
    expect((await leaveReview(1002, 5, 'c1')).map((v) => v.id)).toEqual([5]);
    expect(await leaveReview(1002, 5, 'c2')).toEqual([]);
  });

  it('isole les reviews entre elles et ignore un leave inconnu', async () => {
    await joinReview(2001, viewer(1), 'c1');
    await joinReview(2002, viewer(2), 'c2');
    expect((await getReviewViewers(2001)).map((v) => v.id)).toEqual([1]);
    expect((await getReviewViewers(2002)).map((v) => v.id)).toEqual([2]);
    expect((await leaveReview(2001, 99, 'inconnu')).map((v) => v.id)).toEqual([1]);
  });

  it('rafraîchit l’identité au re-join (avatar présigné le plus récent)', async () => {
    await joinReview(3001, viewer(7, 'Ancien Nom'), 'c1');
    const updated = { ...viewer(7, 'Nouveau Nom'), avatarUrl: 'https://exemple/avatar.png' };
    advance(10);
    expect(await joinReview(3001, updated, 'c2')).toEqual([updated]);
  });

  it('conserve l’ordre d’arrivée, quel que soit l’ordre de stockage', async () => {
    await joinReview(4001, viewer(30), 'c30');
    advance(5);
    await joinReview(4001, viewer(10), 'c10');
    advance(5);
    await joinReview(4001, viewer(20), 'c20');
    expect((await getReviewViewers(4001)).map((v) => v.id)).toEqual([30, 10, 20]);
  });

  it('un spectateur dont le bail est échu n’est plus listé et son entrée est nettoyée', async () => {
    await joinReview(5001, viewer(1), 'c1');
    advance(PRESENCE_TTL_MS + 1);
    expect(await getReviewViewers(5001)).toEqual([]);
    await vi.waitFor(() => expect(redis.peek('review:presence:review:5001')).toBeUndefined());
  });

  it('voit les spectateurs entrés depuis une autre réplique', async () => {
    await joinReview(6001, viewer(1), 'c1');
    const stored = JSON.stringify({ v: viewer(2), j: Date.now() + 1, e: Date.now() + PRESENCE_TTL_MS });
    await redis.call('HSET', 'review:presence:review:6001', '2|distant', stored);
    expect((await getReviewViewers(6001)).map((v) => v.id)).toEqual([1, 2]);
  });

  it('Redis muet : on affiche la vue locale plutôt qu’une salle vide', async () => {
    await joinReview(7001, viewer(1), 'c1');
    redis.failing = true;
    expect((await getReviewViewers(7001)).map((v) => v.id)).toEqual([1]);
  });
});
