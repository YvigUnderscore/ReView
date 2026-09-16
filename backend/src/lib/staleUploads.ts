// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaStatus, type Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { logger } from './logger';
import { storage } from '../services/StorageService';

/** Ce qu'il faut connaître d'un envoi pour effacer les octets qu'il a laissés dans MinIO. */
export type AbandonedUpload = {
  id: number;
  storageKey: string;
  metadata: Prisma.JsonValue | null;
  imageSequence?: { storagePrefix: string } | null;
};

/**
 * Efface ce qu'un envoi qui n'ira pas au bout a déposé dans MinIO.
 *
 * Trois chemins de dépôt, trois traces différentes — et la plus coûteuse est invisible.
 * Un upload multipart jamais complété n'a AUCUN objet à `storageKey` : `CompleteMultipartUpload`
 * n'a pas eu lieu, `DeleteObject` y est donc un no-op, et les parts déjà reçues vivent dans
 * `.minio.sys/multipart/`, que ni `ListObjectsV2`, ni `mc ls`, ni le rapport de stockage de
 * l'administration, ni `mc mirror` ne voient. Seul `AbortMultipartUpload` les libère, et il
 * exige l'`uploadId` — rangé dans `metadata.multipartUploadId`, donc perdu avec la ligne
 * `MediaObject`. Une séquence d'images, elle, a semé N frames entières sous son préfixe :
 * la ligne supprimée, plus rien n'y mènerait.
 *
 * D'où le partage de cette fonction entre l'abandon explicite (le bouton « annuler » du
 * client, `MediaUploadService.abortUpload`) et la purge des envois abandonnés : les deux
 * suppriment la même ligne, elles doivent effacer exactement les mêmes octets.
 *
 * Tout y est « au mieux » : la ligne, elle, doit partir même si MinIO est indisponible.
 */
export async function discardUploadObjects(media: AbandonedUpload): Promise<void> {
  const meta = media.metadata as Record<string, unknown> | null;
  const uploadId = meta?.multipartUploadId;
  if (media.imageSequence) {
    await storage.deletePrefix(media.imageSequence.storagePrefix).catch(() => undefined);
    await storage.deleteObject(media.storageKey).catch(() => undefined);
  } else if (typeof uploadId === 'string') {
    await storage.abortMultipartUpload(media.storageKey, uploadId).catch(() => undefined);
  } else if (media.storageKey) {
    // Clé encore vide : `createUpload` crée la ligne avant de connaître l'identifiant qui
    // compose la clé. Il n'y a alors rien à supprimer, et `DeleteObject ''` est un aller-retour
    // perdu vers MinIO.
    await storage.deleteObject(media.storageKey).catch(() => undefined);
  }
}

/**
 * Envois abandonnés en cours de route.
 *
 * Un média est créé en `UPLOADING` avant même que le premier octet ne parte vers MinIO, et
 * il n'en sort qu'au signal de fin du navigateur. Onglet fermé, poste éteint, réseau coupé :
 * la ligne reste en `UPLOADING` pour toujours. Il existe bien une route d'abandon, mais elle
 * suppose que le client soit encore là pour l'appeler.
 *
 * Ce n'est pas seulement du bruit : `MediaService.createUpload` refuse un nouvel envoi
 * au-delà de `MAX_CONCURRENT_UPLOADS` médias en `UPLOADING` pour un même compte. Au Nᵉ
 * accident — cinq par défaut — l'utilisateur reçoit « Trop d'uploads simultanés » et ne peut
 * plus rien déposer, définitivement, sans intervention d'un administrateur.
 *
 * Le délai est large à dessein : un très gros fichier sur une ligne lente peut légitimement
 * passer plusieurs heures en `UPLOADING`. Douze heures ne peuvent plus être un envoi vivant.
 */
export const STALE_UPLOAD_HOURS = 12;

export async function purgeStaleUploads(hours = STALE_UPLOAD_HOURS): Promise<{ purged: number }> {
  const cutoff = new Date(Date.now() - hours * 3600 * 1000);
  const stale = await prisma.mediaObject.findMany({
    where: { status: MediaStatus.UPLOADING, createdAt: { lt: cutoff } },
    // `metadata` et `imageSequence` portent les seuls fils qui mènent aux octets déjà
    // déposés (identifiant multipart, préfixe de frames). Ne pas les lire AVANT le
    // `deleteMany` revient à les perdre : rien, ensuite, ne permet plus de les retrouver.
    select: {
      id: true,
      storageKey: true,
      metadata: true,
      imageSequence: { select: { storagePrefix: true } },
    },
  });
  if (stale.length === 0) return { purged: 0 };

  // La ligne d'abord : c'est elle qui bloque le compte. L'objet MinIO peut n'avoir jamais
  // été écrit — sa suppression est donc « au mieux », comme partout ailleurs.
  await prisma.mediaObject.deleteMany({ where: { id: { in: stale.map((m) => m.id) } } });
  for (const media of stale) {
    await discardUploadObjects(media);
    await storage.deletePrefix(`derived/${media.id}/`).catch(() => undefined);
  }
  logger.info(
    { purged: stale.length, hours },
    '[Uploads] envois abandonnés nettoyés — les comptes concernés peuvent de nouveau déposer',
  );
  return { purged: stale.length };
}
