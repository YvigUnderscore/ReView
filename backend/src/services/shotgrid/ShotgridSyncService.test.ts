// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { mergeSyncOptions } from './ShotgridSyncService';

/**
 * Merging of synchronization requests that arrived while a pass was running.
 *
 * These requests were simply dropped, and declared successful: on a site where each webhook becomes a job, half of the simultaneous status changes never came back up.
 * The merge rule is therefore conservative — one may over-catch, never under-catch.
 */
describe('mergeSyncOptions', () => {
  const targeted = (sgId: number) => ({
    kind: 'incremental' as const,
    onlySgIds: [{ sgType: 'Shot', sgId }],
  });

  it('adds up two targeted requests', () => {
    const merged = mergeSyncOptions(targeted(1), targeted(2));
    expect(merged.onlySgIds).toEqual([
      { sgType: 'Shot', sgId: 1 },
      { sgType: 'Shot', sgId: 2 },
    ]);
  });

  it('does not duplicate an entity requested twice', () => {
    expect(mergeSyncOptions(targeted(1), targeted(1)).onlySgIds).toHaveLength(1);
  });

  it('widens to the whole project as soon as one request is global', () => {
        // A full pass absorbs the targeted requests: it covers them all.
    expect(mergeSyncOptions(targeted(1), { kind: 'incremental' }).onlySgIds).toBeUndefined();
    expect(mergeSyncOptions({ kind: 'incremental' }, targeted(1)).onlySgIds).toBeUndefined();
  });

  it('keeps the full mode if either of the two requests it', () => {
    expect(mergeSyncOptions({ kind: 'incremental' }, { kind: 'full' }).kind).toBe('full');
    expect(mergeSyncOptions({ kind: 'full' }, { kind: 'incremental' }).kind).toBe('full');
  });

  it('keeps the widest window', () => {
    const vieux = new Date('2026-08-01T00:00:00Z');
    const recent = new Date('2026-08-19T00:00:00Z');
    expect(mergeSyncOptions({ since: recent }, { since: vieux }).since).toEqual(vieux);
        // A request without a window concerns everything: it must not be bounded.
    expect(mergeSyncOptions({ since: recent }, {}).since).toBeNull();
  });

  it('keeps the media as soon as either of the two asks for it', () => {
    expect(mergeSyncOptions({ withMedia: false }, { withMedia: true }).withMedia).toBe(true);
  });

  it('unites the passes of two targeted requests', () => {
        // A note and a version arriving one after the other must both be re-read: keeping only the last would silently lose the other.
    const merged = mergeSyncOptions({ passes: ['notes'] }, { passes: ['versions'] });
    expect(merged.passes).toEqual(['versions', 'notes']);
  });

  it('widens to all passes as soon as one request names none', () => {
    expect(mergeSyncOptions({ passes: ['notes'] }, {}).passes).toBeUndefined();
    expect(mergeSyncOptions({}, { passes: ['notes'] }).passes).toBeUndefined();
  });
});
