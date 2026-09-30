// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { storage, StorageService } from './StorageService';

/**
 * Vignette choisie à la main pour une séquence, un plan ou un asset (C3).
 *
 * La colonne `thumbnailKey` existait, le PATCH l'acceptait, et pourtant aucune entité n'a
 * jamais pu porter d'image : rien dans l'application ne savait produire la clé. Le dépôt
 * se fait donc comme celui d'un avatar — une URL présignée, puis l'enregistrement de la
 * clé — et la clé est reconstruite ici plutôt que reçue du client, pour qu'un appelant ne
 * puisse pas faire pointer une entité vers un objet quelconque du bucket.
 */

export type ThumbnailHolder = 'sequence' | 'shot' | 'asset';

const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
};

/** Le projet qui porte l'entité — c'est lui qui décide de l'accès. */
export async function resolveProject(holder: ThumbnailHolder, id: number): Promise<number> {
  if (holder === 'sequence') {
    const row = await prisma.sequence.findFirst({
      where: { id, deletedAt: null },
      select: { projectId: true },
    });
    if (!row) throw notFound('Sequence not found');
    return row.projectId;
  }
  if (holder === 'shot') {
    const row = await prisma.shot.findFirst({ where: { id, deletedAt: null }, select: { projectId: true } });
    if (!row) throw notFound('Shot not found');
    return row.projectId;
  }
  const row = await prisma.asset.findFirst({ where: { id, deletedAt: null }, select: { projectId: true } });
  if (!row) throw notFound('Asset not found');
  return row.projectId;
}

/** URL de dépôt à durée courte + clé à renvoyer ensuite. */
export async function presign(holder: ThumbnailHolder, id: number, contentType: string) {
  const ext = EXTENSIONS[contentType];
  if (!ext) throw badRequest('Unsupported image type', 'BAD_CONTENT_TYPE');
  const key = StorageService.entityThumbnailKey(holder, id, ext);
  const url = await storage.getPresignedPutUrl(key, contentType, 900);
  return { url, key };
}

/**
 * Enregistre la vignette. `null` la retire — l'entité retombe alors sur la miniature du
 * premier média publié, comme avant.
 */
export async function set(holder: ThumbnailHolder, id: number, key: string | null) {
  // La clé doit désigner l'entité visée : sans ce contrôle, un PATCH suffirait à afficher
  // n'importe quel objet du bucket, y compris le média d'un projet auquel on n'a pas accès.
  if (key !== null) {
    const prefix = `entity-thumbs/${holder}/${id}.`;
    if (!key.startsWith(prefix)) throw badRequest('Thumbnail key does not match the entity', 'BAD_KEY');
    // Le navigateur vient de déposer l'image directement dans MinIO, sous une clé qui ne
    // dépend que de l'entité et de l'extension : remplacer une vignette réécrit donc le
    // même objet. Il faut oublier l'URL mémorisée, sinon les cartes continueraient de
    // servir l'ancienne image depuis le cache navigateur (URL inchangée).
    storage.forgetPresignedUrl(key);
  }
  const data = { thumbnailKey: key };
  if (holder === 'sequence') await prisma.sequence.update({ where: { id }, data });
  else if (holder === 'shot') await prisma.shot.update({ where: { id }, data });
  else await prisma.asset.update({ where: { id }, data });
  return key;
}
