// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaStatus } from '@prisma/client';
import { prisma } from './prisma';
import { logger } from './logger';
import { storage } from '../services/StorageService';

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
    select: { id: true, storageKey: true },
  });
  if (stale.length === 0) return { purged: 0 };

  // La ligne d'abord : c'est elle qui bloque le compte. L'objet MinIO peut n'avoir jamais
  // été écrit — sa suppression est donc « au mieux », comme partout ailleurs.
  await prisma.mediaObject.deleteMany({ where: { id: { in: stale.map((m) => m.id) } } });
  for (const media of stale) {
    if (media.storageKey) await storage.deleteObject(media.storageKey).catch(() => undefined);
    await storage.deletePrefix(`derived/${media.id}/`).catch(() => undefined);
  }
  logger.info(
    { purged: stale.length, hours },
    '[Uploads] envois abandonnés nettoyés — les comptes concernés peuvent de nouveau déposer',
  );
  return { purged: stale.length };
}
