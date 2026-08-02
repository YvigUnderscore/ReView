// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { WatchTargetType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from './NotificationService';

/**
 * Suivi de notifications (32.G) : watch/unwatch par shot, asset ou version.
 * Les suiveurs de toute la chaîne d'un média (version + shot/asset porteurs)
 * sont notifiés des commentaires racine, publications et décisions de review.
 */

/** Tous les suivis de l'utilisateur (léger : sert l'état des menus côté front). */
export async function listForUser(userId: number) {
  return prisma.watch.findMany({
    where: { userId },
    select: { targetType: true, targetId: true },
    orderBy: { id: 'asc' },
  });
}

/** Active/désactive un suivi (idempotent). */
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

/** Ids des suiveurs (dédoublonnés) d'une chaîne version/shot/asset. */
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

/** Chaîne (version, shot, asset) d'un média ; tout à null si média inconnu. */
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

/** Chaîne (version, shot, asset) d'une version ; tout à null si inconnue. */
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
 * Notifie les suiveurs de la chaîne d'un média ou d'une version (type WATCH,
 * referenceId = média navigable vers la review). `exclude` = acteurs et
 * utilisateurs déjà notifiés autrement (mention, décision…).
 */
export async function notifyWatchers(opts: {
  mediaObjectId?: number;
  versionId?: number;
  projectId: number;
  content: string;
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
        type: 'WATCH',
        content: opts.content,
        projectId: opts.projectId,
        referenceId: opts.referenceId ?? opts.mediaObjectId ?? null,
      }),
    ),
  );
  return ids;
}
