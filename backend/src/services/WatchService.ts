// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { WatchTargetType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { type MessageKey, type TParams } from '../i18n';
import { notify } from './NotificationService';

/**
 * Notification follow (32.G): watch/unwatch per shot, asset or version.
 * The followers of a media's whole chain (version + carrying shot/asset) are notified of root comments,
 * publications and review decisions.
 */

/** All of the user's follows (lightweight: serves the menu state on the front end). */
export async function listForUser(userId: number) {
  return prisma.watch.findMany({
    where: { userId },
    select: { targetType: true, targetId: true },
    orderBy: { id: 'asc' },
  });
}

/** Enables/disables a follow (idempotent). */
export async function setWatch(
  userId: number,
  targetType: WatchTargetType,
  targetId: number,
  watching: boolean,
): Promise<boolean> {
  if (watching) {
    await prisma.watch.upsert({
      where: { userId_targetType_targetId: { userId, targetType, targetId } },
      update: {},
      create: { userId, targetType, targetId },
    });
  } else {
    await prisma.watch.deleteMany({ where: { userId, targetType, targetId } });
  }
  return watching;
}

/** Ids of the followers (deduplicated) of a version/shot/asset chain. */
async function watchersForChain(
  versionId: number | null,
  shotId: number | null,
  assetId: number | null,
): Promise<number[]> {
  const targets = [
    ...(versionId ? [{ targetType: WatchTargetType.VERSION, targetId: versionId }] : []),
    ...(shotId ? [{ targetType: WatchTargetType.SHOT, targetId: shotId }] : []),
    ...(assetId ? [{ targetType: WatchTargetType.ASSET, targetId: assetId }] : []),
  ];
  if (targets.length === 0) return [];
  const rows = await prisma.watch.findMany({ where: { OR: targets }, select: { userId: true } });
  return [...new Set(rows.map((r) => r.userId))];
}

/** Chain (version, shot, asset) of a media; all null if the media is unknown. */
async function chainForMedia(mediaObjectId: number) {
  const media = await prisma.mediaObject.findUnique({
    where: { id: mediaObjectId },
    select: {
      versionId: true,
      version: {
        select: { assetId: true, task: { select: { shotId: true, assetId: true } } },
      },
    },
  });
  if (!media) return { versionId: null, shotId: null, assetId: null };
  return {
    versionId: media.versionId,
    shotId: media.version.task?.shotId ?? null,
    assetId: media.version.task?.assetId ?? media.version.assetId ?? null,
  };
}

/** Chain (version, shot, asset) of a version; all null if unknown. */
async function chainForVersion(versionId: number) {
  const version = await prisma.version.findUnique({
    where: { id: versionId },
    select: { assetId: true, task: { select: { shotId: true, assetId: true } } },
  });
  if (!version) return { versionId: null, shotId: null, assetId: null };
  return {
    versionId,
    shotId: version.task?.shotId ?? null,
    assetId: version.task?.assetId ?? version.assetId ?? null,
  };
}

/**
 * Notifies the followers of a media's or a version's chain (type WATCH,
 * referenceId = media navigable to the review). `exclude` = actors and
 * users already notified another way (mention, decision...).
 */
export async function notifyWatchers(opts: {
  mediaObjectId?: number;
  versionId?: number;
  projectId: number;
    /** Translatable key and its parameters (D2): never a ready-made sentence. */
  messageKey: MessageKey;
  params?: TParams;
  referenceId?: number | null;
  exclude?: number[];
}): Promise<number[]> {
  const chain = opts.mediaObjectId
    ? await chainForMedia(opts.mediaObjectId)
    : await chainForVersion(opts.versionId!);
  const excluded = new Set(opts.exclude ?? []);
  const ids = (await watchersForChain(chain.versionId, chain.shotId, chain.assetId)).filter(
    (id) => !excluded.has(id),
  );
  await Promise.all(
    ids.map((userId) =>
      notify({
        userId,
        kind: 'watch',
        messageKey: opts.messageKey,
        params: opts.params,
        projectId: opts.projectId,
        referenceId: opts.referenceId ?? opts.mediaObjectId ?? null,
      }),
    ),
  );
  return ids;
}
