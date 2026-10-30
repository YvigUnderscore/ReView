// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * What the export puts in the file: the reading order of the thread, the displayed frame (base `startFrame`
 * of the project), the version's decision, and above all what a CLIENT account is not allowed to take away.
 */

const { db, scope, sheet, projectSettings } = vi.hoisted(() => ({
  db: {
    playlist: { findUnique: vi.fn() },
    comment: { findMany: vi.fn() },
    project: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
  scope: { collectClips: vi.fn() },
  sheet: { createSheetImages: vi.fn(), sheetLabels: vi.fn() },
  projectSettings: { resolveProjectSettingsById: vi.fn() },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/pipeline', () => ({
  resolveProjectIdForMedia: vi.fn().mockResolvedValue(5),
  resolveProjectIdForVersion: vi.fn().mockResolvedValue(5),
  resolveProjectIdForShot: vi.fn().mockResolvedValue(5),
}));
vi.mock('./CommentExportScope', () => scope);
vi.mock('./CommentExportSheet', () => sheet);
vi.mock('../lib/projectSettings', () => projectSettings);
vi.mock('../lib/settings', () => ({ resolveUserLocale: vi.fn().mockResolvedValue('en') }));
vi.mock('../lib/storage', () => ({ storage: { getObjectBuffer: vi.fn() } }));

import { Role } from '@prisma/client';
import { exportNotes, orderThread } from './CommentExportService';

const clip = {
  mediaId: 7,
  mediaName: 'SH010_comp_v003.mov',
  location: 'SQ010 · SH010 › comp · v003',
  sequence: 'SQ010',
  shot: 'SH010',
  task: 'comp',
  version: 'v003',
  decision: 'Retake',
  duration: 4,
  fps: 24,
  thumbnailKey: null,
  sprite: null,
  aspect: 16 / 9,
};

const author = {
  id: 3,
  name: null,
  email: 'alice@studio.tld',
  firstName: 'Alice',
  lastName: 'B',
  username: 'alice',
};

const comment = (over: Record<string, unknown> = {}) => ({
  id: 12,
  parentId: null,
  mediaObjectId: 7,
  content: '<p>flicker à gauche</p>',
  timestamp: 1.5,
  duration: null,
  timelineTime: null,
  annotation: null,
  state: 'OPEN',
  isResolved: false,
  isVisibleToClient: false,
  createdAt: new Date('2026-08-21T10:30:00Z'),
  guestName: null,
  author,
  resolvedBy: null,
  assignee: null,
  ...over,
});

const viewer = { id: 1, role: Role.ADMIN };

beforeEach(() => {
  vi.clearAllMocks();
  db.playlist.findUnique.mockResolvedValue({ projectId: 5 });
  db.project.findUnique.mockResolvedValue({ startFrame: 1001, name: 'Projet' });
  db.user.findUnique.mockResolvedValue({ preferences: {} });
  db.comment.findMany.mockResolvedValue([comment()]);
  projectSettings.resolveProjectSettingsById.mockResolvedValue({ framerate: 24 });
  scope.collectClips.mockResolvedValue({ label: 'SH010_comp_v003.mov', clips: [clip] });
  sheet.createSheetImages.mockReturnValue(() => Promise.resolve(null));
  sheet.sheetLabels.mockReturnValue({
    frame: 'Frame',
    timecode: 'Timecode',
    state: 'State',
    decision: 'Decision',
    noFrame: 'No frame available',
    printHint: 'Print',
    empty: 'Empty',
    reply: 'Reply',
  });
});

describe('exportNotes: CSV', () => {
  it('produces a named, typed file with one row per note', async () => {
    const file = await exportNotes({ scope: 'media', id: 7, format: 'csv', viewer });
    expect(file.filename).toBe('notes-media-7.csv');
    expect(file.contentType).toBe('text/csv; charset=utf-8');
    expect(file.truncated).toBe(false);
    const [header, line] = file.body.split('\n');
    expect(header?.startsWith('note_id,reply_to,sequence,shot')).toBe(true);
    expect(line).toContain('SQ010,SH010,comp,v003');
    expect(line).toContain('flicker à gauche');
  });

  it('gives the displayed frame of the project and the timecode of the media', async () => {
    const file = await exportNotes({ scope: 'media', id: 7, format: 'csv', viewer });
    const cells = file.body.split('\n')[1]!.split(',');
    expect(cells[7]).toBe('1037'); // 1001 + round(1.5 × 24)
    expect(cells[8]).toBe('00:00:01:12');
    expect(cells[16]).toBe('Retake');
  });

  it('leaves frame and timecode empty for a note without a time reference', async () => {
    db.comment.findMany.mockResolvedValue([comment({ timestamp: null })]);
    const cells = (await exportNotes({ scope: 'media', id: 7, format: 'csv', viewer })).body
      .split('\n')[1]!
      .split(',');
    expect(cells[7]).toBe('');
    expect(cells[8]).toBe('');
  });

  it('reports truncation when the cap is exceeded', async () => {
    db.comment.findMany.mockImplementation(({ take }: { take: number }) =>
      Promise.resolve(Array.from({ length: take }, (_, i) => comment({ id: i + 1 }))),
    );
    const file = await exportNotes({ scope: 'media', id: 7, format: 'csv', viewer });
    expect(file.truncated).toBe(true);
  });
});

describe('exportNotes: scoping', () => {
  it('exports to a CLIENT only the notes visible to them', async () => {
    await exportNotes({ scope: 'media', id: 7, format: 'csv', viewer: { id: 9, role: Role.CLIENT } });
    expect(db.comment.findMany.mock.calls[0]?.[0].where.isVisibleToClient).toBe(true);
  });

  it('lets the team see the whole thread', async () => {
    await exportNotes({ scope: 'media', id: 7, format: 'csv', viewer });
    expect(db.comment.findMany.mock.calls[0]?.[0].where.isVisibleToClient).toBeUndefined();
  });

  it('keeps edit feedback in the edit, out of the timeline scope', async () => {
    await exportNotes({ scope: 'media', id: 7, format: 'csv', viewer });
    expect(db.comment.findMany.mock.calls[0]?.[0].where.OR).toEqual([
      { timelineId: null },
      { sharedToShot: true },
    ]);
  });
});

describe('exportNotes: editorial', () => {
  it('refuses an EDL for anything other than a playlist or an edit', async () => {
    await expect(exportNotes({ scope: 'media', id: 7, format: 'edl', viewer })).rejects.toThrow(
      /playlist or a montage/,
    );
  });

  it('writes the notes of a playlist as EDL markers', async () => {
    const file = await exportNotes({ scope: 'playlist', id: 3, format: 'edl', viewer });
    expect(file.filename).toBe('notes-playlist-3.edl');
    expect(file.body).toContain('* FROM CLIP NAME: SH010_comp_v003.mov');
    expect(file.body).toContain('* LOC: 00:00:01:12 RED alice: flicker à gauche');
  });

  it('writes the same notes as OTIO markers', async () => {
    const file = await exportNotes({ scope: 'playlist', id: 3, format: 'otio', viewer });
    const document = JSON.parse(file.body) as {
      tracks: { children: Array<{ children: Array<{ markers: Array<{ color: string }> }> }> };
    };
    expect(file.contentType).toBe('application/json; charset=utf-8');
    expect(document.tracks.children[0]?.children[0]?.markers[0]?.color).toBe('RED');
  });
});

describe('exportNotes: sheet', () => {
  it('renders a standalone HTML document with the shot context', async () => {
    const file = await exportNotes({ scope: 'media', id: 7, format: 'sheet', viewer });
    expect(file.filename).toBe('notes-media-7.html');
    expect(file.contentType).toBe('text/html; charset=utf-8');
    expect(file.body).toContain('SQ010 · SH010 › comp · v003');
    expect(file.body).toContain('Frame <b>1037</b>');
  });
});

describe('orderThread', () => {
  const note = (id: number, over: Record<string, unknown> = {}) =>
    ({
      id,
      parentId: null,
      mediaObjectId: 7,
      timestamp: null,
      createdAt: new Date(2026, 0, id),
      ...over,
    }) as unknown as Parameters<typeof orderThread>[0][number];

  it('sorts roots by timecode, then attaches each reply to its parent', () => {
    const ordered = orderThread(
      [note(1, { timestamp: 5 }), note(2, { timestamp: 1 }), note(3, { parentId: 2 })],
      [7],
    );
    expect(ordered.map((n) => n.id)).toEqual([2, 3, 1]);
  });

  it('follows the order of the clips before the order of time', () => {
    const ordered = orderThread(
      [note(1, { mediaObjectId: 8, timestamp: 0 }), note(2, { mediaObjectId: 7, timestamp: 9 })],
      [7, 8],
    );
    expect(ordered.map((n) => n.id)).toEqual([2, 1]);
  });

  it('treats as a root a reply whose parent is outside the batch', () => {
    const ordered = orderThread([note(4, { parentId: 999, timestamp: 2 })], [7]);
    expect(ordered.map((n) => n.id)).toEqual([4]);
  });

  it('places notes without a timecode after those that carry one', () => {
    const ordered = orderThread([note(1), note(2, { timestamp: 3 })], [7]);
    expect(ordered.map((n) => n.id)).toEqual([2, 1]);
  });
});
