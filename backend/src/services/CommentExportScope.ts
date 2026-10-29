// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { resolve as resolveTimeline } from './TimelineService';

/**
 * Note export scopes: which media, in what order, with what duration.
 *
 * A notes export always rests on a sequence of media: a single one for a review, the whole playlist for
 * dailies, the edit for editorial. This module brings that sequence into one form (`ClipContext`), which
 * leaves the CSV, EDL, OTIO and sheet serializers exactly the same material.
 */

/** Timeline sprite of the media (regular thumbnails already computed by the worker). */
export interface SpriteMeta {
  key: string;
  intervalSec: number;
  count: number;
  cols: number;
  rows: number;
  tileW: number;
  tileH: number;
}

export interface ClipContext {
  mediaId: number;
  mediaName: string;
  /** Readable location: sequence · shot › task · version. */
  location: string;
  sequence: string;
  shot: string;
  task: string;
  version: string;
  /** Current review decision of the carrying version. */
  decision: string;
  /** Clip duration, in seconds. */
  duration: number;
  fps: number;
  thumbnailKey: string | null;
  sprite: SpriteMeta | null;
  /** Width/height ratio recorded at processing (null = unknown). */
  aspect: number | null;
}

/**
 * Duration retained for a media with no duration of its own (image, 3D, splat). Five seconds is the
 * convention for title cards in editing: long enough to read the note, short enough not to distort the
 * reading of a shot.
 */
export const STILL_SECONDS = 5;

const mediaSelect = {
  id: true,
  originalName: true,
  thumbnailKey: true,
  metadata: true,
  createdAt: true,
  version: {
    select: {
      id: true,
      name: true,
      createdAt: true,
      reviewStatus: { select: { name: true } },
      asset: { select: { name: true } },
      task: {
        select: {
          name: true,
          shot: { select: { code: true, sequence: { select: { code: true } } } },
          asset: { select: { name: true } },
        },
      },
    },
  },
} as const;

type MediaRow = {
  id: number;
  originalName: string;
  thumbnailKey: string | null;
  metadata: unknown;
  version: {
    id: number;
    name: string;
    reviewStatus: { name: string } | null;
    asset: { name: string } | null;
    task: {
      name: string;
      shot: { code: string; sequence: { code: string } | null } | null;
      asset: { name: string } | null;
    } | null;
  };
};

/** A media visible to the requester: published, or uploaded by them (personal draft). */
const visibleTo = (viewerId: number) => ({
  deletedAt: null,
  OR: [{ published: true }, { uploaderId: viewerId }],
});

/** Frame rate recorded at processing; otherwise that of the project. */
export function mediaFps(metadata: unknown, fallback: number): number {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  const raw = meta.frameRate ?? meta.fps;
  const value = typeof raw === 'string' ? Number.parseFloat(raw) : raw;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Duration recorded at processing; otherwise the title-card duration. */
function mediaDuration(metadata: unknown): number {
  const raw = (metadata as { duration?: unknown } | null)?.duration;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : STILL_SECONDS;
}

/** Aspect ratio of the media, when ffprobe recorded its dimensions. */
export function mediaAspect(metadata: unknown): number | null {
  const meta = (metadata ?? {}) as { width?: unknown; height?: unknown };
  const w = typeof meta.width === 'number' ? meta.width : 0;
  const h = typeof meta.height === 'number' ? meta.height : 0;
  return w > 0 && h > 0 ? w / h : null;
}

function mediaSprite(metadata: unknown): SpriteMeta | null {
  const raw = (metadata as { timelineSprite?: Partial<SpriteMeta> } | null)?.timelineSprite;
  if (!raw?.key || !raw.cols || !raw.rows || !raw.tileW || !raw.tileH || !raw.intervalSec) return null;
  return {
    key: raw.key,
    intervalSec: raw.intervalSec,
    count: raw.count ?? raw.cols * raw.rows,
    cols: raw.cols,
    rows: raw.rows,
    tileW: raw.tileW,
    tileH: raw.tileH,
  };
}

/** Where a version lives: under its shot when it has one, otherwise under its asset. */
function locationOf(version: MediaRow['version']): { sequence: string; shot: string; task: string } {
  const task = version.task;
  if (task?.shot) return { sequence: task.shot.sequence?.code ?? '', shot: task.shot.code, task: task.name };
  // An asset version has no shot: the asset name fills the column, whether it comes from the version itself
  // or from the task carrying it.
  const asset = version.asset?.name ?? task?.asset?.name ?? '';
  return { sequence: '', shot: asset, task: task?.name ?? '' };
}

function toClip(media: MediaRow, fallbackFps: number, duration?: number): ClipContext {
  const place = locationOf(media.version);
  const head = [place.sequence, place.shot].filter(Boolean).join(' · ');
  const tail = [place.task, media.version.name].filter(Boolean).join(' · ');
  return {
    mediaId: media.id,
    mediaName: media.originalName,
    location: [head, tail].filter(Boolean).join(' › '),
    ...place,
    version: media.version.name,
    decision: media.version.reviewStatus?.name ?? '',
    duration: duration ?? mediaDuration(media.metadata),
    fps: mediaFps(media.metadata, fallbackFps),
    thumbnailKey: media.thumbnailKey,
    sprite: mediaSprite(media.metadata),
    aspect: mediaAspect(media.metadata),
  };
}

/** Media of a list of versions, in the given order (one clip per media). */
async function mediaOfVersions(versionIds: number[], viewerId: number, fps: number): Promise<ClipContext[]> {
  if (versionIds.length === 0) return [];
  const rows = await prisma.mediaObject.findMany({
    where: { versionId: { in: versionIds }, status: MediaStatus.READY, ...visibleTo(viewerId) },
    orderBy: { createdAt: 'asc' },
    select: mediaSelect,
  });
  const rank = new Map(versionIds.map((id, index) => [id, index]));
  return rows
    .sort((a, b) => (rank.get(a.version.id) ?? 0) - (rank.get(b.version.id) ?? 0))
    .map((m) => toClip(m, fps));
}

/**
 * A playlist shows ONE media per version: the first visible one, as the dailies room does
 * (`PlaylistService.getDetail`). Taking the whole version would double the clips of the exported EDL.
 */
async function playlistClips(id: number, viewerId: number, fps: number): Promise<ClipContext[]> {
  const items = await prisma.playlistItem.findMany({
    where: { playlistId: id, version: { deletedAt: null } },
    orderBy: { order: 'asc' },
    select: { versionId: true },
  });
  const versionIds = items.map((i) => i.versionId);
  if (versionIds.length === 0) return [];
  const rows = await prisma.mediaObject.findMany({
    where: { versionId: { in: versionIds }, status: MediaStatus.READY, ...visibleTo(viewerId) },
    orderBy: { createdAt: 'asc' },
    select: mediaSelect,
  });
  const first = new Map<number, MediaRow>();
  for (const row of rows) if (!first.has(row.version.id)) first.set(row.version.id, row);
  return versionIds
    .map((versionId) => first.get(versionId))
    .filter((row): row is MediaRow => row !== undefined)
    .map((row) => toClip(row, fps));
}

async function timelineClips(id: number, viewerId: number): Promise<{ label: string; clips: ClipContext[] }> {
  const view = await resolveTimeline(id);
  const ids = view.items.map((it) => it.mediaId).filter((m): m is number => m !== null);
  const rows = await prisma.mediaObject.findMany({
    where: { id: { in: ids }, ...visibleTo(viewerId) },
    select: mediaSelect,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const clips: ClipContext[] = [];
  for (const item of view.items) {
    const row = item.mediaId === null ? undefined : byId.get(item.mediaId);
    // The duration comes from the edit, not from the file: it is the one that prevails on the editorial side.
    if (row) clips.push(toClip(row, view.framerate, item.duration));
  }
  return { label: view.name ?? view.sequenceCode ?? `timeline-${id}`, clips };
}

/** Sequence of clips for a scope, with its label (EDL title, sheet subtitle). */
export async function collectClips(
  scope: 'media' | 'version' | 'shot' | 'playlist' | 'timeline',
  id: number,
  viewerId: number,
  fps: number,
): Promise<{ label: string; clips: ClipContext[] }> {
  if (scope === 'media') {
    const row = await prisma.mediaObject.findFirst({
      where: { id, ...visibleTo(viewerId) },
      select: mediaSelect,
    });
    if (!row) throw notFound('Media not found');
    return { label: row.originalName, clips: [toClip(row, fps)] };
  }
  if (scope === 'version') {
    const clips = await mediaOfVersions([id], viewerId, fps);
    return { label: clips[0]?.location ?? `version-${id}`, clips };
  }
  if (scope === 'shot') {
    const shot = await prisma.shot.findUnique({
      where: { id },
      select: {
        code: true,
        sequence: { select: { code: true } },
        tasks: {
          select: {
            versions: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true } },
          },
        },
      },
    });
    if (!shot) throw notFound('Shot not found');
    const versionIds = shot.tasks.flatMap((task) => task.versions.map((v) => v.id));
    const label = [shot.sequence?.code, shot.code].filter(Boolean).join(' · ');
    return { label, clips: await mediaOfVersions(versionIds, viewerId, fps) };
  }
  if (scope === 'playlist') {
    const playlist = await prisma.playlist.findUnique({ where: { id }, select: { name: true } });
    if (!playlist) throw notFound('Playlist not found');
    return { label: playlist.name, clips: await playlistClips(id, viewerId, fps) };
  }
  return timelineClips(id, viewerId);
}
