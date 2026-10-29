// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

// The module pulls the whole synchronization chain: here we only test the conflict rule, which is pure. The heavy dependencies are neutralized.
vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('./ShotgridClient', () => ({ clientForSiteRecord: vi.fn() }));
vi.mock('../JobService', () => ({ shotgridQueue: { add: vi.fn() } }));
vi.mock('../StorageService', () => ({ storage: {}, StorageService: {} }));

import { arbitrate, descriptionPatch, isRealConflict, statusPatch } from './ShotgridPullService';
import type { PullContext } from './ShotgridPullService';

const T = (iso: string) => new Date(iso);
const SYNC = T('2026-08-20T10:00:00Z');
const APRES = T('2026-08-20T10:05:00Z');
const AVANT = T('2026-08-20T09:55:00Z');

describe('isRealConflict', () => {
  it('sees no conflict when both sides carry the same value', () => {
    // The case that polluted the studio's journal: "review: ip, shotgrid: ip".
    expect(
      isRealConflict({
        localUpdatedAt: APRES,
        linkSyncedAt: SYNC,
        reviewValue: 'ip',
        remoteValue: 'ip',
      }),
    ).toBe(false);
  });

  it('sees a conflict when the values diverge after a local write', () => {
    expect(
      isRealConflict({
        localUpdatedAt: APRES,
        linkSyncedAt: SYNC,
        reviewValue: 'rdy',
        remoteValue: 'hld',
      }),
    ).toBe(true);
  });

  it('treats "absent on both sides" as an agreement', () => {
    expect(
      isRealConflict({ localUpdatedAt: APRES, linkSyncedAt: SYNC, reviewValue: null, remoteValue: null }),
    ).toBe(false);
  });

  it('sees a conflict when only one side carries a value', () => {
    expect(
      isRealConflict({ localUpdatedAt: APRES, linkSyncedAt: SYNC, reviewValue: 'ip', remoteValue: null }),
    ).toBe(true);
    expect(
      isRealConflict({ localUpdatedAt: APRES, linkSyncedAt: SYNC, reviewValue: null, remoteValue: 'ip' }),
    ).toBe(true);
  });

  it('sees nothing as long as the ReView side has not moved since the synchronization', () => {
    expect(
      isRealConflict({
        localUpdatedAt: AVANT,
        linkSyncedAt: SYNC,
        reviewValue: 'rdy',
        remoteValue: 'hld',
      }),
    ).toBe(false);
  });

  it('tolerates a second of gap: the write and the link timestamp are not simultaneous', () => {
    expect(
      isRealConflict({
        localUpdatedAt: new Date(SYNC.getTime() + 900),
        linkSyncedAt: SYNC,
        reviewValue: 'rdy',
        remoteValue: 'hld',
      }),
    ).toBe(false);
    expect(
      isRealConflict({
        localUpdatedAt: new Date(SYNC.getTime() + 1500),
        linkSyncedAt: SYNC,
        reviewValue: 'rdy',
        remoteValue: 'hld',
      }),
    ).toBe(true);
  });

  it('concludes nothing without a date: a never-synchronized link is not a conflict', () => {
    expect(isRealConflict({ localUpdatedAt: APRES, linkSyncedAt: null })).toBe(false);
    expect(isRealConflict({ localUpdatedAt: null, linkSyncedAt: SYNC })).toBe(false);
  });

  it('sticks to the date when the caller supplies no values', () => {
    // The plans pull supplies none: the original behaviour is kept.
    expect(isRealConflict({ localUpdatedAt: APRES, linkSyncedAt: SYNC })).toBe(true);
  });
});

describe('statusPatch', () => {
  const map = new Map([
    ['ip', { id: 7, code: 'ip' } as never],
    ['fin', { id: 9, code: 'fin' } as never],
  ]);

  it('propagates a status emptied on the site side', () => {
    // The site erased the status: that is a decision, and it must come down.
    expect(statusPatch(null, map)).toEqual({ patch: { pipelineStatusId: null }, unknownCode: null });
    expect(statusPatch('', map)).toEqual({ patch: { pipelineStatusId: null }, unknownCode: null });
  });

  it('writes the status when the code is known', () => {
    expect(statusPatch('ip', map)).toEqual({ patch: { pipelineStatusId: 7 }, unknownCode: null });
  });

  it('writes nothing and reports when the code is unknown', () => {
    // The heart of the defect: the old code wrote `null` here — status silently erased.
    const { patch, unknownCode } = statusPatch('omg', map);
    expect(patch).toEqual({});
    expect('pipelineStatusId' in patch).toBe(false);
    expect(unknownCode).toBe('omg');
  });

  it('keeps the local status when the map is empty', () => {
    // Empty map = ordinary case (statuses.read closed, site schema inaccessible).
    // A routine pass must not empty the statuses of a whole project.
    expect(statusPatch('ip', new Map())).toEqual({ patch: {}, unknownCode: 'ip' });
  });
});

describe('arbitrate', () => {
  it('applies the three studio policies', () => {
    // The setting offered three and applied only one: ShotGrid always won, even when the screen displayed "ReView wins".
    expect(arbitrate('sg_wins')).toBe('overwrite');
    expect(arbitrate('review_wins')).toBe('keep');
    expect(arbitrate('manual')).toBe('defer');
  });

  it('falls back on ShotGrid when the policy is absent or unknown', () => {
    expect(arbitrate(undefined)).toBe('overwrite');
    expect(arbitrate('nawak')).toBe('overwrite');
  });
});

describe('descriptionPatch', () => {
  /** A context reduced to what the function reads: the source setting. */
  const ctx = (source: 'shotgrid' | 'review') =>
    ({ settings: { descriptions: { source, writeBack: false } } }) as unknown as PullContext;

  it('copies the site description when the site is authoritative', () => {
    expect(descriptionPatch(ctx('shotgrid'), 'Le héros entre par la gauche')).toEqual({
      description: 'Le héros entre par la gauche',
    });
  });

  it("translates the site's emptiness to null rather than an empty string", () => {
    // Otherwise the two would coexist in the column, and "no description" would cease to be a question we can answer.
    expect(descriptionPatch(ctx('shotgrid'), '   ')).toEqual({ description: null });
    expect(descriptionPatch(ctx('shotgrid'), null)).toEqual({ description: null });
    expect(descriptionPatch(ctx('shotgrid'), undefined)).toEqual({ description: null });
  });

  it('writes nothing when ReView is authoritative: otherwise the import would overwrite the local brief', () => {
    expect(descriptionPatch(ctx('review'), 'texte du site')).toEqual({});
  });
});
