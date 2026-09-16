// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaStatus } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Doublures : la file BullMQ et la base. Ce qui est mesuré ici, c'est le **nombre et la
 * portée des lectures Redis** — `getJobs` sans plage rapatrie tout l'arriéré, job complet
 * par job complet, à chaque passe d'entretien.
 */
const mocks = vi.hoisted(() => ({
  getJobs: vi.fn<(types: string[], start?: number, end?: number) => Promise<unknown[]>>(),
  findMany: vi.fn<() => Promise<{ id: number; createdAt: Date; metadata: unknown }[]>>(),
  updateMany: vi.fn<(args: unknown) => Promise<{ count: number }>>(),
}));
vi.mock('../services/JobService', () => ({ mediaQueue: { getJobs: mocks.getJobs } }));
vi.mock('./prisma', () => ({
  prisma: { mediaObject: { findMany: mocks.findMany, updateMany: mocks.updateMany } },
}));
vi.mock('./logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import {
  liveMediaJobIds,
  LIVE_JOB_SCAN_MAX,
  MEDIA_STUCK_AFTER_MS,
  reconcileAction,
  reconcileFailureMessage,
  reconcileStuckMedia,
} from './mediaReconcile';

afterEach(() => {
  mocks.getJobs.mockReset();
  mocks.findMany.mockReset();
  mocks.updateMany.mockReset();
});

/** Faux job BullMQ : seule sa charge utile compte pour la réconciliation. */
const job = (mediaObjectId: number) => ({ data: { mediaObjectId } });

const candidate = (over: Partial<Parameters<typeof reconcileAction>[0]> = {}) => ({
  id: 1,
  ageMs: MEDIA_STUCK_AFTER_MS + 1,
  hasLiveJob: false,
  ...over,
});

describe('reconcileAction', () => {
  it('un job vivant protège le média, même très ancien', () => {
    expect(reconcileAction(candidate({ hasLiveJob: true, ageMs: 48 * 3600_000 }))).toBe('skip');
  });

  it('un média récent est épargné : le balayage ne court pas plus vite que l’enfilage', () => {
    expect(reconcileAction(candidate({ ageMs: 0 }))).toBe('skip');
    expect(reconcileAction(candidate({ ageMs: MEDIA_STUCK_AFTER_MS - 1 }))).toBe('skip');
  });

  it('ancien et sans job vivant : échec explicite', () => {
    expect(reconcileAction(candidate({ ageMs: MEDIA_STUCK_AFTER_MS }))).toBe('fail');
    expect(reconcileAction(candidate({ ageMs: 3 * MEDIA_STUCK_AFTER_MS }))).toBe('fail');
  });

  it('le seuil est paramétrable', () => {
    expect(reconcileAction(candidate({ ageMs: 5000 }), 1000)).toBe('fail');
    expect(reconcileAction(candidate({ ageMs: 500 }), 1000)).toBe('skip');
  });

  it('les deux conditions doivent être réunies', () => {
    expect(reconcileAction(candidate({ hasLiveJob: true, ageMs: 0 }))).toBe('skip');
    expect(reconcileAction(candidate({ hasLiveJob: false, ageMs: 0 }))).toBe('skip');
    expect(reconcileAction(candidate({ hasLiveJob: true, ageMs: 1e9 }))).toBe('skip');
    expect(reconcileAction(candidate({ hasLiveJob: false, ageMs: 1e9 }))).toBe('fail');
  });
});

describe('reconcileFailureMessage', () => {
  it('message actionnable, en anglais, avec la durée en minutes', () => {
    expect(reconcileFailureMessage(90 * 60_000)).toContain('90 min');
    expect(reconcileFailureMessage(90 * 60_000)).toMatch(/^Processing was interrupted/);
  });

  it('jamais « 0 min » : un plancher d’une minute', () => {
    expect(reconcileFailureMessage(1200)).toContain('1 min');
  });

  it('tient dans les 500 caractères conservés par le worker', () => {
    expect(reconcileFailureMessage(10 ** 9).length).toBeLessThan(500);
  });
});

// ── Coût du relevé des jobs vivants ──────────────────────────────────────────

describe('liveMediaJobIds', () => {
  it('borne sa lecture Redis par une plage explicite', async () => {
    mocks.getJobs.mockResolvedValue([job(1), job(2), job(2), { data: {} }, null]);
    const live = await liveMediaJobIds();
    expect(live.ids).toEqual(new Set([1, 2]));
    expect(live.complete).toBe(true);
    // Une seule lecture, et une plage — pas `getJobs(types)` qui ramène tout l'arriéré.
    expect(mocks.getJobs).toHaveBeenCalledTimes(1);
    const [types, start, end] = mocks.getJobs.mock.calls[0]!;
    expect(types).toEqual(['waiting', 'active', 'delayed', 'paused', 'prioritized', 'waiting-children']);
    expect(start).toBe(0);
    expect(end).toBe(LIVE_JOB_SCAN_MAX - 1);
  });

  it('signale un relevé saturé plutôt que de le croire exhaustif', async () => {
    mocks.getJobs.mockResolvedValue(Array.from({ length: LIVE_JOB_SCAN_MAX }, (_, i) => job(i + 1)));
    const live = await liveMediaJobIds();
    expect(live.complete).toBe(false);
  });
});

describe('reconcileStuckMedia', () => {
  const old = new Date(Date.now() - 3 * MEDIA_STUCK_AFTER_MS);
  const now = new Date();

  it('condamne le média sans job vivant et épargne celui qui en a un', async () => {
    mocks.findMany.mockResolvedValue([
      { id: 10, createdAt: old, metadata: { width: 1920 } },
      { id: 11, createdAt: old, metadata: null },
    ]);
    mocks.getJobs.mockResolvedValue([job(11)]);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    expect(await reconcileStuckMedia(now)).toBe(1);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    const arg = mocks.updateMany.mock.calls[0]?.[0] as {
      where: { id: number; status: MediaStatus };
      data: { status: MediaStatus; metadata: Record<string, unknown> };
    };
    expect(arg.where).toEqual({ id: 10, status: MediaStatus.PROCESSING });
    expect(arg.data.status).toBe(MediaStatus.FAILED);
    // Les métadonnées existantes sont conservées, le motif est ajouté.
    expect(arg.data.metadata.width).toBe(1920);
    expect(String(arg.data.metadata.processingError)).toMatch(/^Processing was interrupted/);
  });

  it('ne condamne personne quand le relevé des jobs est tronqué', async () => {
    mocks.findMany.mockResolvedValue([{ id: 10, createdAt: old, metadata: null }]);
    mocks.getJobs.mockResolvedValue(Array.from({ length: LIVE_JOB_SCAN_MAX }, (_, i) => job(i + 1000)));
    expect(await reconcileStuckMedia(now)).toBe(0);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('ne lit même pas la file quand aucun média n’est figé', async () => {
    mocks.findMany.mockResolvedValue([]);
    expect(await reconcileStuckMedia(now)).toBe(0);
    expect(mocks.getJobs).not.toHaveBeenCalled();
  });
});
