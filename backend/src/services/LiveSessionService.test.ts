import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseLiveKey,
  joinLive,
  leaveLive,
  handoffLive,
  isLivePilot,
  getLiveState,
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
  it('le premier arrivant devient pilote, les suivants spectateurs', () => {
    const s1 = joinLive('media:1', p(10));
    expect(s1.pilotId).toBe(10);
    const s2 = joinLive('media:1', p(20));
    expect(s2.pilotId).toBe(10);
    expect(s2.participants.map((x) => x.id)).toEqual([10, 20]);
  });

  it('re-join du même utilisateur : idempotent (pas de doublon)', () => {
    joinLive('media:1', p(10));
    const s = joinLive('media:1', p(10));
    expect(s.participants).toHaveLength(1);
  });

  it('départ du pilote : la main passe au plus ancien participant restant', () => {
    joinLive('media:1', p(10));
    joinLive('media:1', p(20));
    joinLive('media:1', p(30));
    const s = leaveLive('media:1', 10);
    expect(s?.pilotId).toBe(20);
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

  it('le pilote donne la main à un participant présent', () => {
    const s = handoffLive('media:1', 10, 20);
    expect(s?.pilotId).toBe(20);
    expect(isLivePilot('media:1', 20)).toBe(true);
  });

  it('refusé si l’émetteur n’est pas pilote ou si la cible est absente', () => {
    expect(handoffLive('media:1', 20, 10)).toBeNull();
    expect(handoffLive('media:1', 10, 99)).toBeNull();
    expect(isLivePilot('media:1', 10)).toBe(true);
  });
});
