// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  type LiveParticipant,
} from './LiveSessionService';

const p = (id: number): LiveParticipant => ({
  id,
  displayName: `User ${id}`,
  initials: `U${id}`,
  avatarUrl: null,
});

beforeEach(() => {
  resetLiveSessions();
});

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
  it('le premier arrivant devient pilote ET driver, les suivants spectateurs', () => {
    const s1 = joinLive('media:1', p(10));
    expect(s1.pilotId).toBe(10);
    expect(s1.driverId).toBe(10);
    const s2 = joinLive('media:1', p(20));
    expect(s2.pilotId).toBe(10);
    expect(s2.participants.map((x) => x.id)).toEqual([10, 20]);
  });

  it('re-join du même utilisateur : idempotent (pas de doublon)', () => {
    joinLive('media:1', p(10));
    const s = joinLive('media:1', p(10));
    expect(s.participants).toHaveLength(1);
  });

  it('départ du pilote : la main passe au premier co-pilote sinon au plus ancien', () => {
    joinLive('media:1', p(10));
    joinLive('media:1', p(20));
    joinLive('media:1', p(30));
    setCoHost('media:1', 10, 30, true);
    const s = leaveLive('media:1', 10);
    expect(s?.pilotId).toBe(30);
    expect(s?.coHostIds).toEqual([]);
    expect(s?.driverId).toBe(30);
  });

  it('dernier départ : la session est fermée', () => {
    joinLive('media:1', p(10));
    expect(leaveLive('media:1', 10)).toBeNull();
    expect(getLiveState('media:1')).toBeNull();
  });

  it('leave d’un non-participant : no-op (null), la session survit', () => {
    joinLive('media:1', p(10));
    expect(leaveLive('media:1', 99)).toBeNull();
    expect(getLiveState('media:1')?.participants).toHaveLength(1);
  });
});

describe('handoffLive (33.B)', () => {
  beforeEach(() => {
    joinLive('media:1', p(10));
    joinLive('media:1', p(20));
  });

  it('le pilote donne la main à un participant présent (driver suit)', () => {
    const s = handoffLive('media:1', 10, 20);
    expect(s?.pilotId).toBe(20);
    expect(s?.driverId).toBe(20);
  });

  it('refusé si l’émetteur n’est pas pilote ou si la cible est absente', () => {
    expect(handoffLive('media:1', 20, 10)).toBeNull();
    expect(handoffLive('media:1', 10, 99)).toBeNull();
    expect(getLiveState('media:1')?.pilotId).toBe(10);
  });
});

describe('co-pilotes & driver (retours CP-HUMAIN 33)', () => {
  beforeEach(() => {
    joinLive('media:1', p(10));
    joinLive('media:1', p(20));
    joinLive('media:1', p(30));
  });

  it('seul le pilote nomme/retire un co-pilote (cible présente, pas lui-même)', () => {
    expect(setCoHost('media:1', 20, 30, true)).toBeNull();
    expect(setCoHost('media:1', 10, 10, true)).toBeNull();
    expect(setCoHost('media:1', 10, 99, true)).toBeNull();
    const s = setCoHost('media:1', 10, 20, true);
    expect(s?.coHostIds).toEqual([20]);
    expect(canDriveLive('media:1', 20)).toBe(true);
    expect(canDriveLive('media:1', 30)).toBe(false);
  });

  it('claimDrive : un co-pilote qui interagit devient driver ; un spectateur non', () => {
    setCoHost('media:1', 10, 20, true);
    expect(claimDrive('media:1', 30)).toBeNull();
    const s = claimDrive('media:1', 20);
    expect(s?.driverId).toBe(20);
    expect(isLiveDriver('media:1', 20)).toBe(true);
    // Déjà driver → pas de nouvel état (pas de re-broadcast).
    expect(claimDrive('media:1', 20)).toBeNull();
    // Le pilote peut reprendre la main en interagissant.
    expect(claimDrive('media:1', 10)?.driverId).toBe(10);
  });

  it('retirer le co-pilotage du driver → la main revient au pilote', () => {
    setCoHost('media:1', 10, 20, true);
    claimDrive('media:1', 20);
    const s = setCoHost('media:1', 10, 20, false);
    expect(s?.coHostIds).toEqual([]);
    expect(s?.driverId).toBe(10);
  });

  it('départ du driver co-pilote → la main revient au pilote', () => {
    setCoHost('media:1', 10, 20, true);
    claimDrive('media:1', 20);
    const s = leaveLive('media:1', 20);
    expect(s?.driverId).toBe(10);
  });
});

describe('méta & liste des sessions par projet (retours 33 — badges LIVE)', () => {
  it('la méta est posée à la création et conservée aux joins suivants', () => {
    joinLive('media:1', p(10), { projectId: 7, mediaId: 1, versionId: 3 });
    joinLive('media:1', p(20), { projectId: 99, mediaId: 1 }); // ignorée (déjà posée)
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

  it('ne liste que le projet demandé ; session fermée → disparaît', () => {
    joinLive('media:1', p(10), { projectId: 7, mediaId: 1 });
    joinLive('playlist:2', p(20), { projectId: 8, playlistId: 2 });
    expect(listLiveSessions(7).map((s) => s.key)).toEqual(['media:1']);
    leaveLive('media:1', 10);
    expect(listLiveSessions(7)).toEqual([]);
    expect(getLiveProjectId('media:1')).toBeNull();
  });
});

describe('grâce de déconnexion (retours 33 — F5 garde le rôle de pilote)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-join pendant la grâce : le départ est annulé, le pilote garde la main', () => {
    joinLive('media:1', p(10));
    joinLive('media:1', p(20));
    const onLeft = vi.fn();
    scheduleLiveLeave('media:1', 10, onLeft, 5000);
    vi.advanceTimersByTime(3000);
    expect(cancelLiveLeave('media:1', 10)).toBe(true);
    const s = joinLive('media:1', p(10));
    vi.advanceTimersByTime(10_000);
    expect(onLeft).not.toHaveBeenCalled();
    expect(s.pilotId).toBe(10);
    expect(getLiveState('media:1')?.pilotId).toBe(10);
  });

  it('grâce échue : le départ est appliqué et notifié (main transmise)', () => {
    joinLive('media:1', p(10));
    joinLive('media:1', p(20));
    const onLeft = vi.fn();
    scheduleLiveLeave('media:1', 10, onLeft, 5000);
    vi.advanceTimersByTime(5000);
    expect(onLeft).toHaveBeenCalledOnce();
    expect(onLeft.mock.calls[0]?.[0]?.pilotId).toBe(20);
    expect(cancelLiveLeave('media:1', 10)).toBe(false);
  });

  it('reprogrammation : un second schedule remplace le premier (un seul départ)', () => {
    joinLive('media:1', p(10));
    const onLeft = vi.fn();
    scheduleLiveLeave('media:1', 10, onLeft, 5000);
    vi.advanceTimersByTime(3000);
    scheduleLiveLeave('media:1', 10, onLeft, 5000);
    vi.advanceTimersByTime(4000);
    expect(onLeft).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onLeft).toHaveBeenCalledOnce();
  });
});
