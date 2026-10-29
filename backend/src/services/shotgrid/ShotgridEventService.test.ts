// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` is hoisted to the top of the file: the doubles must be too.
const { connection, runSync } = vi.hoisted(() => ({
  connection: { findUnique: vi.fn(), update: vi.fn() },
  runSync: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({ prisma: { shotgridConnection: connection } }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/queues', () => ({ shotgridQueue: { add: vi.fn() } }));
vi.mock('./ShotgridSyncService', () => ({ runSync: (...args: unknown[]) => runSync(...args) }));

import { coalesceKey, handleEvent, parseEventType } from './ShotgridEventService';

const LINKED = {
  id: 1,
  projectId: 42,
  active: true,
  sgProjectId: 77,
  sgProjectName: 'ALPHA',
  settings: {},
};

function event(type: string, entityId: number) {
  return {
    event_type: type,
    entity: { type: type.split('_')[1], id: entityId },
    project: { type: 'Project', id: 77, name: 'ALPHA' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  connection.findUnique.mockResolvedValue(LINKED);
  runSync.mockResolvedValue({ runId: 1, status: 'ok', stats: {} });
});

describe('parseEventType', () => {
  it('reads the entity type and the action', () => {
    expect(parseEventType('Shotgun_Note_New')).toEqual({ entity: 'Note', action: 'New' });
    expect(parseEventType('Shotgun_Version_Change')).toEqual({ entity: 'Version', action: 'Change' });
    expect(parseEventType('bruit')).toBeNull();
    expect(parseEventType(undefined)).toBeNull();
  });
});

/**
 * A global entity triggers the same re-read whatever its identifier. Grouping must therefore ignore it: otherwise fifty accounts renamed
 * at once would produce fifty identical full passes. The case stops being theoretical as soon as a webhook without a project filter brings
 * the site's `Person` and `Status` records.
 */
describe('coalesceKey', () => {
  it('groups global entities by their type alone', () => {
    expect(coalesceKey('HumanUser', 11)).toBe(coalesceKey('HumanUser', 22));
    expect(coalesceKey('Status', 3)).toBe('Status');
  });

  it('keeps the identifier for a production entity', () => {
    expect(coalesceKey('Shot', 11)).toBe('Shot-11');
    expect(coalesceKey('Shot', 11)).not.toBe(coalesceKey('Shot', 12));
  });

  it('does not confuse two global types with each other', () => {
    expect(coalesceKey('Status', 1)).not.toBe(coalesceKey('HumanUser', 1));
  });
});

/**
 * The inbound direction of notes and playlists was dead: the event was accepted, then processed by a pass that did not know how to read them.
 * These checks hold the mapping "received event -> pass executed".
 */
describe('handleEvent', () => {
  it('finally imports the note designated by the event', async () => {
    await handleEvent(1, event('Shotgun_Note_New', 501));

    expect(runSync).toHaveBeenCalledWith(42, {
      kind: 'webhook',
      passes: ['notes'],
      onlySgIds: [{ sgType: 'Note', sgId: 501 }],
    });
  });

  it('imports the playlist designated by the event', async () => {
    await handleEvent(1, event('Shotgun_Playlist_Change', 88));

    expect(runSync).toHaveBeenCalledWith(42, {
      kind: 'webhook',
      passes: ['playlists'],
      onlySgIds: [{ sgType: 'Playlist', sgId: 88 }],
    });
  });

  it('does not replay the whole project for a version', async () => {
    await handleEvent(1, event('Shotgun_Version_Change', 9001));

    const options = runSync.mock.calls[0]![1] as { passes: string[]; onlySgIds: unknown };
    expect(options.passes).toEqual(['versions']);
    expect(options.onlySgIds).toEqual([{ sgType: 'Version', sgId: 9001 }]);
  });

  it('re-reads the whole hierarchy for a status, without targeting an entity', async () => {
    await handleEvent(1, {
      event_type: 'Shotgun_Status_Change',
      entity: { type: 'Status', id: 3 },
      project: { type: 'Project', id: 77, name: 'ALPHA' },
    });

    const options = runSync.mock.calls[0]![1] as { passes: string[]; onlySgIds?: unknown };
    expect(options.passes).toEqual(['statuses', 'episodes', 'sequences', 'shots', 'assets', 'tasks']);
    expect(options.onlySgIds).toBeUndefined();
  });

  it('refuses an event coming from another project of the site', async () => {
    // A site hosts all the studio's projects: a misconfigured webhook delivers the neighbour's events, and writing into the
    // wrong project cannot be undone.
    await handleEvent(1, {
      event_type: 'Shotgun_Shot_Change',
      entity: { type: 'Shot', id: 5 },
      project: { type: 'Project', id: 78, name: 'BRAVO' },
    });

    expect(runSync).not.toHaveBeenCalled();
  });

  it('does nothing when the studio has chosen manual mode', async () => {
    connection.findUnique.mockResolvedValue({ ...LINKED, settings: { eventMode: 'manual' } });
    await handleEvent(1, event('Shotgun_Note_New', 501));
    expect(runSync).not.toHaveBeenCalled();
  });

  it('does nothing on a disabled connection', async () => {
    connection.findUnique.mockResolvedValue({ ...LINKED, active: false });
    await handleEvent(1, event('Shotgun_Note_New', 501));
    expect(runSync).not.toHaveBeenCalled();
  });
});
