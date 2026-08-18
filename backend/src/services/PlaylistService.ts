// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { storage } from './StorageService';
import { enqueuePush } from './shotgrid/ShotgridPushService';

type SessionUser = { id: number; role: Role };

const isManager = (role: Role) => role === Role.ADMIN || role === Role.SUPERVISOR;

/** Peut modifier/supprimer : créateur de la playlist ou superviseur/admin. */
const assertCanEdit = (user: SessionUser, playlist: { createdById: number | null }) => {
  if (!isManager(user.role) && playlist.createdById !== user.id)
    throw forbidden('Modification réservée au créateur ou un superviseur');
};

/** Playlists d'un projet (liste légère : compteur d'items, créateur). */
export async function listForProject(projectId: number) {
  return prisma.playlist.findMany({
    where: { projectId },
    orderBy: { updatedAt: 'desc' },
    include: {
      createdBy: { select: { id: true, name: true } },
      // Le compteur ne comptait pas ce que la playlist montre : une version mise à la
      // corbeille restait dans le total, et la playlist annonçait « 12 » pour dix items.
      _count: { select: { items: { where: { version: { deletedAt: null } } } } },
    },
  });
}

/**
 * Résout les versions à ajouter : `versionIds` directs et/ou `mediaIds` (chaque média
 * → sa version). Toutes doivent appartenir au projet de la playlist (cross-shots OK).
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
    throw badRequest('Certaines versions n’appartiennent pas au projet de la playlist');
  // L'ordre d'entrée est conservé (l'utilisateur a ordonné sa sélection).
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
  if (existing) throw conflict('Une playlist de ce nom existe déjà dans le projet');
  const playlist = await prisma.playlist.create({
    data: {
      projectId,
      name,
      createdById: user.id,
      items: { create: toAdd.map((versionId, i) => ({ versionId, order: i })) },
    },
    include: { _count: { select: { items: { where: { version: { deletedAt: null } } } } } },
  });
  // Ajouter et retirer remontaient vers le site ; créer et renommer, non. Une playlist
  // née dans ReView n'existait donc nulle part sur ShotGrid, et la première tentative
  // d'y pousser un item n'avait aucune destination.
  await syncToShotgrid(playlist.id, projectId, user.id);
  return playlist;
}

/** Charge une playlist (ou 404) et renvoie aussi son projectId pour le RBAC des routes. */
export async function getOwning(id: number) {
  const playlist = await prisma.playlist.findUnique({
    where: { id },
    select: { id: true, projectId: true, createdById: true },
  });
  if (!playlist) throw notFound('Playlist introuvable');
  return playlist;
}

/**
 * Détail : items ordonnés, chaque item avec sa version (nom, décision, localisation
 * lisible) et son premier média visible (même règle brouillon que MediaService :
 * publié, ou uploadé par le demandeur) — support de la lecture enchaînée.
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
  if (!playlist) throw notFound('Playlist introuvable');
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
  if (dup && dup.id !== id) throw conflict('Une playlist de ce nom existe déjà dans le projet');
  const updated = await prisma.playlist.update({ where: { id }, data: { name } });
  await syncToShotgrid(id, playlist.projectId, user.id);
  return updated;
}

/** Ajoute des versions en fin de playlist (déduplique celles déjà présentes). */
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

/** Remonte la playlist vers ShotGrid après une modification (contenu ou ordre). */
async function syncToShotgrid(playlistId: number, projectId: number, actorId: number) {
  await enqueuePush(projectId, { type: 'playlist', playlistId, actorId });
}

/**
 * Réordonne la playlist : `itemIds` donne le nouvel ordre des items **visibles**.
 *
 * L'exhaustivité était exigée, et le détail masque les items dont la version est en
 * corbeille : dès qu'une seule version était supprimée, réordonner devenait impossible —
 * l'écran renvoyait la liste qu'il affichait, le serveur la refusait. Les items non cités
 * conservent donc leur place relative, à la suite de ceux qu'on vient d'ordonner.
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
  if (count === 0) throw notFound('Item introuvable dans cette playlist');
  await syncToShotgrid(id, playlist.projectId, user.id);
}

export async function remove(user: SessionUser, id: number) {
  const playlist = await getOwning(id);
  assertCanEdit(user, playlist);
  await prisma.playlist.delete({ where: { id } });
}
