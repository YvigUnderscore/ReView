// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La portée décide de ce qui entre dans l'export : quels médias, dans quel ordre, avec
 * quelle durée. Deux règles ne se voient qu'ici — une playlist ne prend qu'un média par
 * version, et un montage impose SA durée de clip, pas celle du fichier.
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
  it('lit la cadence relevée au traitement, sous ses deux noms', () => {
    expect(mediaFps({ frameRate: 23.98 }, 24)).toBe(23.98);
    expect(mediaFps({ fps: '25' }, 24)).toBe(25);
  });

  it('retombe sur la cadence du projet quand le média n’en porte pas', () => {
    expect(mediaFps({}, 24)).toBe(24);
    expect(mediaFps({ frameRate: 0 }, 24)).toBe(24);
    expect(mediaFps(null, 24)).toBe(24);
  });

  it('ne calcule un rapport d’image que si les deux dimensions sont connues', () => {
    expect(mediaAspect({ width: 1920, height: 1080 })).toBeCloseTo(16 / 9);
    expect(mediaAspect({ width: 1920 })).toBeNull();
    expect(mediaAspect(null)).toBeNull();
  });
});

describe('collectClips — média', () => {
  it('rend un clip unique, situé dans le pipe', async () => {
    db.mediaObject.findFirst.mockResolvedValue(media(7));
    const { label, clips } = await collectClips('media', 7, 1, 24);
    expect(label).toBe('SH07_comp.mov');
    expect(clips[0]?.location).toBe('SQ010 · SH07 › comp · v003');
    expect(clips[0]?.decision).toBe('Retake');
    expect(clips[0]?.fps).toBe(25);
    expect(clips[0]?.duration).toBe(4);
  });

  it('refuse un média que le demandeur ne voit pas', async () => {
    db.mediaObject.findFirst.mockResolvedValue(null);
    await expect(collectClips('media', 7, 1, 24)).rejects.toThrow(/Media not found/);
  });

  it('donne une durée de carton à un média sans durée propre', async () => {
    db.mediaObject.findFirst.mockResolvedValue(media(7, { metadata: {} }));
    const { clips } = await collectClips('media', 7, 1, 24);
    expect(clips[0]?.duration).toBe(STILL_SECONDS);
  });
});

describe('collectClips — playlist', () => {
  it('garde un seul média par version, dans l’ordre de la playlist', async () => {
    db.playlist.findUnique.mockResolvedValue({ name: 'Dailies 21/08' });
    db.playlistItem.findMany.mockResolvedValue([{ versionId: 108 }, { versionId: 107 }]);
    const second = media(8, { id: 9, version: { ...media(8).version, id: 108 } });
    db.mediaObject.findMany.mockResolvedValue([media(7), media(8), second]);
    const { label, clips } = await collectClips('playlist', 3, 1, 24);
    expect(label).toBe('Dailies 21/08');
    expect(clips.map((c) => c.mediaId)).toEqual([8, 7]);
  });

  it('rend une playlist vide sans interroger les médias', async () => {
    db.playlist.findUnique.mockResolvedValue({ name: 'vide' });
    db.playlistItem.findMany.mockResolvedValue([]);
    const { clips } = await collectClips('playlist', 3, 1, 24);
    expect(clips).toEqual([]);
    expect(db.mediaObject.findMany).not.toHaveBeenCalled();
  });
});

describe('collectClips — montage', () => {
  it('prend la durée du montage et saute les trous', async () => {
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

describe('collectClips — shot', () => {
  it('rassemble les versions de toutes les tâches du plan', async () => {
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
