// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  ALL_PASSES,
  eventIsGlobal,
  HANDLED_ENTITIES,
  impliedPasses,
  mergePasses,
  passesForEvent,
  resolvePasses,
  sgIdsOfType,
} from './ShotgridSyncPasses';

/**
 * The defect repaired here is silent: a Note or Playlist event was accepted, queued and processed — without ever importing anything, for lack of a pass able to read it.
 * These checks hold the link between "accepted event type" and "pass actually executed".
 */
describe('passesForEvent', () => {
  it('triggers a notes pass for a Note event', () => {
    expect(passesForEvent('Note')).toEqual(['notes']);
  });

  it('triggers a playlists pass for a Playlist event', () => {
    expect(passesForEvent('Playlist')).toEqual(['playlists']);
  });

  it('re-reads only the versions for a Version event', () => {
    // The status reference is not used here: the version reads its persisted match, and a full pass of the hierarchy would cost thousands of requests.
    expect(passesForEvent('Version')).toEqual(['versions']);
  });

  it('accompanies with the reference any pass that reads a status', () => {
    for (const entity of ['Sequence', 'Shot', 'Task']) {
      expect(passesForEvent(entity)).toContain('statuses');
    }
    // The asset carries no status on the ReView side: it does without one.
    expect(passesForEvent('Asset')).toEqual(['assets']);
  });

  it('re-reads the whole hierarchy for a global entity, without the media', () => {
    expect(passesForEvent('Status')).toEqual([
      'statuses',
      'episodes',
      'sequences',
      'shots',
      'assets',
      'tasks',
    ]);
    expect(passesForEvent('Status')).not.toContain('versions');
    expect(eventIsGlobal('Status')).toBe(true);
    expect(eventIsGlobal('HumanUser')).toBe(true);
    expect(eventIsGlobal('Shot')).toBe(false);
  });

  it('ignores a type that no pass can handle', () => {
    expect(passesForEvent('Ticket')).toBeNull();
    expect(HANDLED_ENTITIES.has('Ticket')).toBe(false);
  });

  it('accepts only the types actually handled', () => {
    // The list of accepted entities is deduced from the passes table: they can no longer diverge, which was exactly the default of notes and playlists.
    for (const entity of HANDLED_ENTITIES) expect(passesForEvent(entity)).not.toBeNull();
  });
});

describe('impliedPasses', () => {
  it('deduces the passes from the targeted type', () => {
    expect(impliedPasses([{ sgType: 'Shot', sgId: 3 }])).toEqual(['statuses', 'shots']);
  });

  it('unites the passes of several targeted types, in canonical order', () => {
    expect(
      impliedPasses([
        { sgType: 'Version', sgId: 1 },
        { sgType: 'Sequence', sgId: 2 },
      ]),
    ).toEqual(['statuses', 'episodes', 'sequences', 'versions']);
  });

  it('returns "everything" when nothing is targeted or the type is unknown', () => {
    expect(impliedPasses(undefined)).toBeUndefined();
    expect(impliedPasses([])).toBeUndefined();
    expect(impliedPasses([{ sgType: 'Ticket', sgId: 9 }])).toBeUndefined();
  });
});

describe('resolvePasses', () => {
  it('runs everything when nothing is specified', () => {
    expect([...resolvePasses({})]).toEqual([...ALL_PASSES]);
  });

  it('prefers the explicit list to the deduction', () => {
    const passes = resolvePasses({ passes: ['notes'], onlySgIds: [{ sgType: 'Shot', sgId: 1 }] });
    expect([...passes]).toEqual(['notes']);
  });

  it('spares notes, playlists and publishes when realigning a single card', () => {
    // This is the heart of the fix: realigning a shot swept the project's five thousand
    // `PublishedFile` and its five hundred notes.
    const passes = resolvePasses({ onlySgIds: [{ sgType: 'Shot', sgId: 12 }] });
    expect(passes.has('notes')).toBe(false);
    expect(passes.has('playlists')).toBe(false);
    expect(passes.has('publishedFiles')).toBe(false);
    expect(passes.has('shots')).toBe(true);
  });

  it('keeps "structure only" as a veto over the deduced list', () => {
    // Arbitrating a version conflict requires `withMedia: false`: the deduction must not reopen the door to fetching media.
    const passes = resolvePasses({ onlySgIds: [{ sgType: 'Version', sgId: 7 }], withMedia: false });
    expect(passes.has('versions')).toBe(false);
  });

  it('respects "structure only" without targeting', () => {
    const passes = resolvePasses({ withMedia: false });
    expect(passes.has('versions')).toBe(false);
    expect(passes.has('notes')).toBe(false);
    expect(passes.has('shots')).toBe(true);
  });
});

describe('mergePasses', () => {
  it('unit deux listes', () => {
    expect(mergePasses(['notes'], ['versions'])).toEqual(['versions', 'notes']);
  });

  it('lets "everything" absorb a list', () => {
    expect(mergePasses(['notes'], undefined)).toBeUndefined();
    expect(mergePasses(undefined, ['notes'])).toBeUndefined();
  });
});

describe('sgIdsOfType', () => {
  it('extracts the identifiers of a type, without duplicates', () => {
    const ids = sgIdsOfType(
      [
        { sgType: 'Note', sgId: 4 },
        { sgType: 'Version', sgId: 9 },
        { sgType: 'Note', sgId: 4 },
        { sgType: 'Note', sgId: 5 },
      ],
      'Note',
    );
    expect(ids).toEqual([4, 5]);
  });

  it('returns an empty list when nothing is targeted', () => {
    expect(sgIdsOfType(undefined, 'Note')).toEqual([]);
    expect(sgIdsOfType([{ sgType: 'Shot', sgId: 1 }], 'Note')).toEqual([]);
  });
});
