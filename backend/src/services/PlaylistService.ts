// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { storage } from './StorageService';
import { effectiveThumbnailUrl } from '../lib/thumbnails';
import { enqueuePush } from './shotgrid/ShotgridPushService';

type SessionUser = { id: number; role: Role };

const isManager = (role: Role) => role === Role.ADMIN || role === Role.SUPERVISOR;

/** May modify/delete: the playlist's creator or a supervisor/admin. */
const assertCanEdit = (user: SessionUser, playlist: { createdById: number | null }) => {
  if (!isManager(user.role) && playlist.createdById !== user.id)
    throw forbidden('Only the creator or a supervisor can change this');
};

/** Playlists of a project (light list: item counter, creator). */
export async function listForProject(projectId: number) {
  const playlists = await prisma.playlist.findMany({
    where: { projectId },
    orderBy: { updatedAt: 'desc' },
    include: {
      createdBy: { select: { id: true, name: true } },
      // The counter did not count what the playlist shows: a version moved to the trash remained in the
      // total, and the playlist announced "12" for ten items.
      _count: { select: { items: { where: { version: { deletedAt: null } } } } },
      // The first images of the playlist: a dailies list is identified by what it contains, not by its name —
      // "Dailies Tuesday" and "Dailies Wednesday" are only told apart by the image. Four suffice to make a
      // recognisable strip.
      items: {
        where: { version: { deletedAt: null } },
        orderBy: { order: 'asc' },
        take: PREVIEW_COUNT,
        select: {
          version: {
            select: {
              media: {
                where: { deletedAt: null, thumbnailKey: { not: null } },
                select: { thumbnailKey: true },
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  return Promise.all(
    playlists.map(async ({ items, ...playlist }) => ({
      ...playlist,
      previews: (
        await Promise.all(
          items.map((item) => effectiveThumbnailUrl(item.version.media[0]?.thumbnailKey ?? null, null)),
        )
      ).filter((url): url is string => url !== null),
    })),
  );
}

/** Thumbnails shown on a playlist card. Beyond that, the strip stops being legible. */
const PREVIEW_COUNT = 4;

/**
 * Resolves the versions to add: direct `versionIds` and/or `mediaIds` (each media → its version). All of them
 * must belong to the playlist's project (cross-shot OK).
 */
async function resolveVersionIds(projectId: number, versionIds: number[], mediaIds: number[]) {
  const fromMedia =
    mediaIds.length > 0
      ? await prisma.mediaObject.findMany({
          where: { id: { in: mediaIds }, deletedAt: null },
          select: { versionId: true },
        })
      : [];
  const ids = [...new Set([...versionIds, ...fromMedia.map((m) => m.versionId)])];
  if (ids.length === 0) return [];
  const versions = await prisma.version.findMany({
    where: {
      id: { in: ids },
      deletedAt: null,
      OR: [{ task: { shot: { projectId } } }, { task: { asset: { projectId } } }, { asset: { projectId } }],
    },
    select: { id: true },
  });
  if (versions.length !== ids.length)
    throw badRequest('Some versions do not belong to the project of this playlist');
  // The input order is kept (the user ordered their selection).
  const valid = new Set(versions.map((v) => v.id));
  return ids.filter((id) => valid.has(id));
}

export async function create(
  user: SessionUser,
  projectId: number,
  name: string,
  versionIds: number[] = [],
  mediaIds: number[] = [],
) {
  const toAdd = await resolveVersionIds(projectId, versionIds, mediaIds);
  const existing = await prisma.playlist.findUnique({
    where: { projectId_name: { projectId, name } },
  });
  if (existing) throw conflict('A playlist with this name already exists in the project');
  const playlist = await prisma.playlist.create({
    data: {
      projectId,
      name,
      createdById: user.id,
      items: { create: toAdd.map((versionId, i) => ({ versionId, order: i })) },
    },
    include: { _count: { select: { items: { where: { version: { deletedAt: null } } } } } },
  });
  // Adding and removing used to propagate up to the site; creating and renaming did not. A playlist born in
  // ReView therefore existed nowhere on ShotGrid, and the first attempt
  // to push an item there had no destination.
  await syncToShotgrid(playlist.id, projectId, user.id);
  return playlist;
}

/** Loads a playlist (or 404) and also returns its projectId for the routes' RBAC. */
export async function getOwning(id: number) {
  const playlist = await prisma.playlist.findUnique({
    where: { id },
    select: { id: true, projectId: true, createdById: true },
  });
  if (!playlist) throw notFound('Playlist not found');
  return playlist;
}

/**
 * Detail: ordered items, each item with its version (name, decision, readable location) and its first visible
 * media (same draft rule as MediaService: published, or uploaded by the
 * requester) — support for sequential playback.
 */
export async function getDetail(user: SessionUser, id: number) {
  const playlist = await prisma.playlist.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, name: true } },
      items: {
        orderBy: { order: 'asc' },
        include: {
          version: {
            select: {
              id: true,
              name: true,
              deletedAt: true,
              reviewStatus: { select: { id: true, name: true, color: true } },
              task: {
                select: {
                  name: true,
                  shot: { select: { code: true, sequence: { select: { code: true } } } },
                  asset: { select: { name: true } },
                },
              },
              asset: { select: { name: true } },
              media: {
                where: {
                  deletedAt: null,
                  status: 'READY',
                  OR: [{ published: true }, { uploaderId: user.id }],
                },
                orderBy: { createdAt: 'asc' },
                select: { id: true, kind: true, originalName: true, thumbnailKey: true },
              },
            },
          },
        },
      },
    },
  });
  if (!playlist) throw notFound('Playlist not found');
  const items = await Promise.all(
    playlist.items
      .filter((it) => !it.version.deletedAt)
      .map(async (it) => {
        const v = it.version;
        const t = v.task;
        const location = t?.shot
          ? `${t.shot.sequence ? t.shot.sequence.code + ' · ' : ''}${t.shot.code} › ${t.name}`
          : t?.asset
            ? `${t.asset.name} › ${t.name}`
            : (v.asset?.name ?? '');
        const first = v.media[0] ?? null;
        return {
          id: it.id,
          order: it.order,
          version: {
            id: v.id,
            name: v.name,
            reviewStatus: v.reviewStatus,
            location,
            mediaCount: v.media.length,
          },
          media: first
            ? {
                id: first.id,
                kind: first.kind,
                originalName: first.originalName,
                thumbnailUrl: first.thumbnailKey
                  ? await storage.getPresignedGetUrl(first.thumbnailKey)
                  : null,
              }
            : null,
        };
      }),
  );
  return {
    id: playlist.id,
    projectId: playlist.projectId,
    name: playlist.name,
    createdBy: playlist.createdBy,
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt,
    items,
  };
}

export async function rename(user: SessionUser, id: number, name: string) {
  const playlist = await getOwning(id);
  assertCanEdit(user, playlist);
  const dup = await prisma.playlist.findUnique({
    where: { projectId_name: { projectId: playlist.projectId, name } },
  });
  if (dup && dup.id !== id) throw conflict('A playlist with this name already exists in the project');
  const updated = await prisma.playlist.update({ where: { id }, data: { name } });
  await syncToShotgrid(id, playlist.projectId, user.id);
  return updated;
}

/** Adds versions at the end of the playlist (de-duplicates those already present). */
export async function addItems(
  user: SessionUser,
  id: number,
  versionIds: number[] = [],
  mediaIds: number[] = [],
) {
  const playlist = await getOwning(id);
  assertCanEdit(user, playlist);
  const resolved = await resolveVersionIds(playlist.projectId, versionIds, mediaIds);
  const current = await prisma.playlistItem.findMany({
    where: { playlistId: id },
    select: { versionId: true, order: true },
  });
  const present = new Set(current.map((c) => c.versionId));
  const toAdd = resolved.filter((vid) => !present.has(vid));
  let order = current.reduce((max, c) => Math.max(max, c.order), -1) + 1;
  await prisma.$transaction([
    ...toAdd.map((versionId) =>
      prisma.playlistItem.create({ data: { playlistId: id, versionId, order: order++ } }),
    ),
    prisma.playlist.update({ where: { id }, data: { updatedAt: new Date() } }),
  ]);
  await syncToShotgrid(id, playlist.projectId, user.id);
  return { added: toAdd.length, skipped: resolved.length - toAdd.length };
}

/** Pushes the playlist up to ShotGrid after a change (content or order). */
async function syncToShotgrid(playlistId: number, projectId: number, actorId: number) {
  await enqueuePush(projectId, { type: 'playlist', playlistId, actorId });
}

/**
 * Reorders the playlist: `itemIds` gives the new order of the **visible** items.
 *
 * Completeness was required, and the detail hides the items whose version is in the trash: as soon as a
 * single version had been deleted, reordering became impossible — the screen
 * returned the list it displayed, and the server refused it. The items not cited therefore keep their
 * relative place, following those just ordered.
 */
export async function reorder(user: SessionUser, id: number, itemIds: number[]) {
  const playlist = await getOwning(id);
  assertCanEdit(user, playlist);
  const items = await prisma.playlistItem.findMany({
    where: { playlistId: id },
    orderBy: { order: 'asc' },
    select: { id: true },
  });
  const known = new Set(items.map((i) => i.id));
  const unknown = itemIds.find((i) => !known.has(i));
  if (unknown !== undefined) throw badRequest('This item does not belong to the playlist');
  const cited = new Set(itemIds);
  const rest = items.filter((i) => !cited.has(i.id)).map((i) => i.id);
  const finalOrder = [...itemIds, ...rest];
  await prisma.$transaction(
    finalOrder.map((itemId, order) => prisma.playlistItem.update({ where: { id: itemId }, data: { order } })),
  );
  await syncToShotgrid(id, playlist.projectId, user.id);
}

export async function removeItem(user: SessionUser, id: number, itemId: number) {
  const playlist = await getOwning(id);
  assertCanEdit(user, playlist);
  const { count } = await prisma.playlistItem.deleteMany({ where: { id: itemId, playlistId: id } });
  if (count === 0) throw notFound('This item is not in the playlist');
  await syncToShotgrid(id, playlist.projectId, user.id);
}

export async function remove(user: SessionUser, id: number) {
  const playlist = await getOwning(id);
  assertCanEdit(user, playlist);
  await prisma.playlist.delete({ where: { id } });
}
