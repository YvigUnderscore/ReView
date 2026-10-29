// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The scope decides what goes into the export: which media, in what order, with which duration. Two rules are
 * visible only here: a playlist takes only one media per version, and an edit imposes ITS clip duration, not
 * the file's.
 */

const { db, timeline } = vi.hoisted(() => ({
  db: {
    mediaObject: { findFirst: vi.fn(), findMany: vi.fn() },
    playlistItem: { findMany: vi.fn() },
    playlist: { findUnique: vi.fn() },
    shot: { findUnique: vi.fn() },
  },
  timeline: { resolve: vi.fn() },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./TimelineService', () => timeline);

import { collectClips, mediaAspect, mediaFps, STILL_SECONDS } from './CommentExportScope';

const media = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  originalName: `SH0${id}_comp.mov`,
  thumbnailKey: `derived/${id}/thumb.jpg`,
  metadata: { duration: 4, frameRate: 25, width: 1920, height: 1080 },
  createdAt: new Date(2026, 0, id),
  version: {
    id: 100 + id,
    name: 'v003',
    createdAt: new Date(2026, 0, id),
    reviewStatus: { name: 'Retake' },
    asset: null,
    task: { name: 'comp', shot: { code: `SH0${id}`, sequence: { code: 'SQ010' } }, asset: null },
  },
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('mediaFps / mediaAspect', () => {
  it('reads the frame rate recorded at processing, under either of its two names', () => {
    expect(mediaFps({ frameRate: 23.98 }, 24)).toBe(23.98);
    expect(mediaFps({ fps: '25' }, 24)).toBe(25);
  });

  it('falls back to the project frame rate when the media does not carry one', () => {
    expect(mediaFps({}, 24)).toBe(24);
    expect(mediaFps({ frameRate: 0 }, 24)).toBe(24);
    expect(mediaFps(null, 24)).toBe(24);
  });

  it('computes an aspect ratio only when both dimensions are known', () => {
    expect(mediaAspect({ width: 1920, height: 1080 })).toBeCloseTo(16 / 9);
    expect(mediaAspect({ width: 1920 })).toBeNull();
    expect(mediaAspect(null)).toBeNull();
  });
});

describe('collectClips: media', () => {
  it('returns a single clip, placed in the pipe', async () => {
    db.mediaObject.findFirst.mockResolvedValue(media(7));
    const { label, clips } = await collectClips('media', 7, 1, 24);
    expect(label).toBe('SH07_comp.mov');
    expect(clips[0]?.location).toBe('SQ010 · SH07 › comp · v003');
    expect(clips[0]?.decision).toBe('Retake');
    expect(clips[0]?.fps).toBe(25);
    expect(clips[0]?.duration).toBe(4);
  });

  it('refuses a media the requester cannot see', async () => {
    db.mediaObject.findFirst.mockResolvedValue(null);
    await expect(collectClips('media', 7, 1, 24)).rejects.toThrow(/Media not found/);
  });

  it('gives a title-card duration to a media with no duration of its own', async () => {
    db.mediaObject.findFirst.mockResolvedValue(media(7, { metadata: {} }));
    const { clips } = await collectClips('media', 7, 1, 24);
    expect(clips[0]?.duration).toBe(STILL_SECONDS);
  });
});

describe('collectClips: playlist', () => {
  it('keeps a single media per version, in playlist order', async () => {
    db.playlist.findUnique.mockResolvedValue({ name: 'Dailies 21/08' });
    db.playlistItem.findMany.mockResolvedValue([{ versionId: 108 }, { versionId: 107 }]);
    const second = media(8, { id: 9, version: { ...media(8).version, id: 108 } });
    db.mediaObject.findMany.mockResolvedValue([media(7), media(8), second]);
    const { label, clips } = await collectClips('playlist', 3, 1, 24);
    expect(label).toBe('Dailies 21/08');
    expect(clips.map((c) => c.mediaId)).toEqual([8, 7]);
  });

  it('returns an empty playlist without querying the media', async () => {
    db.playlist.findUnique.mockResolvedValue({ name: 'vide' });
    db.playlistItem.findMany.mockResolvedValue([]);
    const { clips } = await collectClips('playlist', 3, 1, 24);
    expect(clips).toEqual([]);
    expect(db.mediaObject.findMany).not.toHaveBeenCalled();
  });
});

describe('collectClips: edit', () => {
  it('takes the edit duration and skips the gaps', async () => {
    timeline.resolve.mockResolvedValue({
      name: null,
      sequenceCode: 'SQ010',
      framerate: 24,
      items: [
        { mediaId: 7, duration: 2.5 },
        { mediaId: null, duration: 3 },
      ],
    });
    db.mediaObject.findMany.mockResolvedValue([media(7)]);
    const { label, clips } = await collectClips('timeline', 4, 1, 24);
    expect(label).toBe('SQ010');
    expect(clips).toHaveLength(1);
    expect(clips[0]?.duration).toBe(2.5);
  });
});

describe('collectClips: shot', () => {
  it('gathers the versions of all the tasks of the shot', async () => {
    db.shot.findUnique.mockResolvedValue({
      code: 'SH010',
      sequence: { code: 'SQ010' },
      tasks: [{ versions: [{ id: 107 }] }, { versions: [{ id: 108 }] }],
    });
    db.mediaObject.findMany.mockResolvedValue([media(7)]);
    const { label, clips } = await collectClips('shot', 2, 1, 24);
    expect(label).toBe('SQ010 · SH010');
    expect(db.mediaObject.findMany.mock.calls[0]?.[0].where.versionId).toEqual({ in: [107, 108] });
    expect(clips).toHaveLength(1);
  });
});
