// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from './prisma';
import { storage } from '../services/StorageService';
import { enqueueStorageCleanup } from '../services/JobService';
import { logger } from './logger';

/**
 * Corbeille : soft-delete / restauration / purge définitive, avec cascade descendante
 * et nettoyage des objets MinIO à la purge.
 *
 * Cascade (soft-delete & restore) :
 *   Sequence → Shots
 *   Asset    → Versions → Médias
 *   Version  → Médias
 *   Shot / Média : pas d'enfant porteur de deletedAt
 *   Project  : marqué seul (ses listings sont déjà filtrés par projet visible)
 *
 * Note : la restauration d'un parent restaure aussi ses descendants supprimés.
 */

type MediaKeys = { storageKey: string; thumbnailKey: string | null };

/** Aplati les clés storage (média + miniature) d'une liste de médias. */
function mediaStorageKeys(medias: MediaKeys[]): string[] {
  const keys: string[] = [];
  for (const m of medias) {
    if (m.storageKey) keys.push(m.storageKey);
    if (m.thumbnailKey) keys.push(m.thumbnailKey);
  }
  return keys;
}

/**
 * Supprime des objets MinIO **après** que la DB a été purgée. Ne lève jamais : un
 * échec storage n'a plus d'impact sur la cohérence DB (déjà committée). Les clés en
 * échec sont journalisées et enfilées pour retry (journal des orphelins, cf. 10.D7).
 */
async function deleteStorageAfterCommit(keys: string[], prefixes: string[] = []): Promise<void> {
  const failedKeys: string[] = [];
  for (const key of keys) {
    try {
      await storage.deleteObject(key);
    } catch (err) {
      failedKeys.push(key);
      logger.warn({ err, key }, '[Trash] suppression objet storage échouée (retry enfilé)');
    }
  }
  const failedPrefixes: string[] = [];
  for (const prefix of prefixes) {
    try {
      await storage.deletePrefix(prefix);
    } catch (err) {
      failedPrefixes.push(prefix);
      logger.warn({ err, prefix }, '[Trash] suppression préfixe storage échouée (retry enfilé)');
    }
  }
  if (failedKeys.length > 0 || failedPrefixes.length > 0) {
    await enqueueStorageCleanup({ keys: failedKeys, prefixes: failedPrefixes }).catch((err) =>
      logger.error(
        { err, keys: failedKeys, prefixes: failedPrefixes },
        "[Trash] impossible d'enfiler le nettoyage storage — orphelins non retentés",
      ),
    );
  }
}

// ── Soft-delete ───────────────────────────────────────────────────────────────

export async function softDeleteSequence(id: number): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.shot.updateMany({ where: { sequenceId: id }, data: { deletedAt: now } }),
    prisma.sequence.update({ where: { id }, data: { deletedAt: now } }),
  ]);
}

export async function softDeleteShot(id: number): Promise<void> {
  await prisma.shot.update({ where: { id }, data: { deletedAt: new Date() } });
}

/**
 * Épisode : aucune cascade, contrairement à la séquence.
 *
 * Un épisode regroupe des séquences, il ne les possède pas. Emporter avec lui ses
 * séquences — et derrière elles les plans, les versions et les commentaires — ferait
 * d'un geste de rangement une destruction de production. Le rattachement (`episodeId`)
 * est conservé tel quel : la restauration rend l'épisode exactement comme il était.
 */
export async function softDeleteEpisode(id: number): Promise<void> {
  await prisma.episode.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function softDeleteAsset(id: number): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.mediaObject.updateMany({ where: { version: { assetId: id } }, data: { deletedAt: now } }),
    prisma.version.updateMany({ where: { assetId: id }, data: { deletedAt: now } }),
    prisma.asset.update({ where: { id }, data: { deletedAt: now } }),
  ]);
}

export async function softDeleteVersion(id: number): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.mediaObject.updateMany({ where: { versionId: id }, data: { deletedAt: now } }),
    prisma.version.update({ where: { id }, data: { deletedAt: now } }),
  ]);
}

export async function softDeleteMedia(id: number): Promise<void> {
  await prisma.mediaObject.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function softDeleteProject(id: number): Promise<void> {
  await prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
}

// ── Soft-delete en lot (13.C) ─────────────────────────────────────────────────
// Une seule transaction par domaine (updateMany), cascade descendante identique au
// singulier. Les ids ont déjà été validés (accès projet) par le BulkService appelant.

export async function softDeleteSequences(ids: number[]): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.shot.updateMany({ where: { sequenceId: { in: ids } }, data: { deletedAt: now } }),
    prisma.sequence.updateMany({ where: { id: { in: ids } }, data: { deletedAt: now } }),
  ]);
}

export async function softDeleteShots(ids: number[]): Promise<void> {
  await prisma.shot.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
}

export async function softDeleteEpisodes(ids: number[]): Promise<void> {
  await prisma.episode.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
}

export async function softDeleteAssets(ids: number[]): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.mediaObject.updateMany({ where: { version: { assetId: { in: ids } } }, data: { deletedAt: now } }),
    prisma.version.updateMany({ where: { assetId: { in: ids } }, data: { deletedAt: now } }),
    prisma.asset.updateMany({ where: { id: { in: ids } }, data: { deletedAt: now } }),
  ]);
}

export async function softDeleteVersions(ids: number[]): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.mediaObject.updateMany({ where: { versionId: { in: ids } }, data: { deletedAt: now } }),
    prisma.version.updateMany({ where: { id: { in: ids } }, data: { deletedAt: now } }),
  ]);
}

export async function softDeleteMedias(ids: number[]): Promise<void> {
  await prisma.mediaObject.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
}

export async function softDeleteProjects(ids: number[]): Promise<void> {
  await prisma.project.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
}

// ── Restauration ────────────────────────────────────────────────────────────────

export async function restoreSequence(id: number): Promise<void> {
  await prisma.$transaction([
    prisma.shot.updateMany({ where: { sequenceId: id }, data: { deletedAt: null } }),
    prisma.sequence.update({ where: { id }, data: { deletedAt: null } }),
  ]);
}

export async function restoreShot(id: number): Promise<void> {
  await prisma.shot.update({ where: { id }, data: { deletedAt: null } });
}

export async function restoreEpisode(id: number): Promise<void> {
  await prisma.episode.update({ where: { id }, data: { deletedAt: null } });
}

export async function restoreAsset(id: number): Promise<void> {
  await prisma.$transaction([
    prisma.mediaObject.updateMany({ where: { version: { assetId: id } }, data: { deletedAt: null } }),
    prisma.version.updateMany({ where: { assetId: id }, data: { deletedAt: null } }),
    prisma.asset.update({ where: { id }, data: { deletedAt: null } }),
  ]);
}

export async function restoreVersion(id: number): Promise<void> {
  await prisma.$transaction([
    prisma.mediaObject.updateMany({ where: { versionId: id }, data: { deletedAt: null } }),
    prisma.version.update({ where: { id }, data: { deletedAt: null } }),
  ]);
}

export async function restoreMedia(id: number): Promise<void> {
  await prisma.mediaObject.update({ where: { id }, data: { deletedAt: null } });
}

export async function restoreProject(id: number): Promise<void> {
  await prisma.project.update({ where: { id }, data: { deletedAt: null } });
}

// ── Restauration en lot (13.C) ────────────────────────────────────────────────

export async function restoreSequences(ids: number[]): Promise<void> {
  await prisma.$transaction([
    prisma.shot.updateMany({ where: { sequenceId: { in: ids } }, data: { deletedAt: null } }),
    prisma.sequence.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } }),
  ]);
}

export async function restoreShots(ids: number[]): Promise<void> {
  await prisma.shot.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } });
}

export async function restoreEpisodes(ids: number[]): Promise<void> {
  await prisma.episode.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } });
}

export async function restoreAssets(ids: number[]): Promise<void> {
  await prisma.$transaction([
    prisma.mediaObject.updateMany({
      where: { version: { assetId: { in: ids } } },
      data: { deletedAt: null },
    }),
    prisma.version.updateMany({ where: { assetId: { in: ids } }, data: { deletedAt: null } }),
    prisma.asset.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } }),
  ]);
}

export async function restoreVersions(ids: number[]): Promise<void> {
  await prisma.$transaction([
    prisma.mediaObject.updateMany({ where: { versionId: { in: ids } }, data: { deletedAt: null } }),
    prisma.version.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } }),
  ]);
}

export async function restoreMedias(ids: number[]): Promise<void> {
  await prisma.mediaObject.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } });
}

export async function restoreProjects(ids: number[]): Promise<void> {
  await prisma.project.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } });
}

// ── Purge définitive (DB + MinIO) ────────────────────────────────────────────────

// Invariant 10.D7 : la suppression DB (atomique via cascade) précède TOUJOURS la
// suppression storage. Un échec MinIO ne laisse donc jamais la DB incohérente ;
// les objets orphelins sont journalisés et retentés (deleteStorageAfterCommit).

export async function purgeMedia(id: number): Promise<void> {
  const media = await prisma.mediaObject.findUnique({
    where: { id },
    select: { storageKey: true, thumbnailKey: true },
  });
  if (!media) return;
  await prisma.mediaObject.delete({ where: { id } });
  await deleteStorageAfterCommit(mediaStorageKeys([media]));
}

export async function purgeVersion(id: number): Promise<void> {
  const medias = await prisma.mediaObject.findMany({
    where: { versionId: id },
    select: { storageKey: true, thumbnailKey: true },
  });
  await prisma.version.delete({ where: { id } }); // cascade DB des médias
  await deleteStorageAfterCommit(mediaStorageKeys(medias));
}

export async function purgeShot(id: number): Promise<void> {
  const medias = await prisma.mediaObject.findMany({
    where: { version: { task: { shotId: id } } },
    select: { storageKey: true, thumbnailKey: true },
  });
  await prisma.shot.delete({ where: { id } }); // cascade DB : tasks → versions → médias
  await deleteStorageAfterCommit(mediaStorageKeys(medias));
}

export async function purgeAsset(id: number): Promise<void> {
  const medias = await prisma.mediaObject.findMany({
    where: { version: { OR: [{ assetId: id }, { task: { assetId: id } }] } },
    select: { storageKey: true, thumbnailKey: true },
  });
  await prisma.asset.delete({ where: { id } });
  await deleteStorageAfterCommit(mediaStorageKeys(medias));
}

export async function purgeSequence(id: number): Promise<void> {
  // La suppression d'une séquence remet sequenceId à null sur ses shots (SetNull) :
  // aucun média à purger ici.
  await prisma.sequence.delete({ where: { id } });
}

/**
 * Purge d'un épisode. Ses séquences survivent, simplement détachées (`ON DELETE SET
 * NULL`) : un épisode est un regroupement, pas un propriétaire — le détruire ne doit
 * emporter ni plan, ni version, ni commentaire. Aucun objet MinIO à retirer.
 */
export async function purgeEpisode(id: number): Promise<void> {
  await prisma.episode.delete({ where: { id } });
}

export async function purgeProject(id: number): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id }, select: { slug: true } });
  if (!project) return;
  await prisma.project.delete({ where: { id } }); // cascade DB intégrale
  // Storage après commit — nouvelles clés lisibles + anciennes clés numériques (legacy).
  await deleteStorageAfterCommit([], [`projects/${project.slug}/`, `projects/${id}/`]);
}

// ── Purge automatique (balayage planifié) ────────────────────────────────────────

/**
 * Plafond d'une passe de purge automatique. Chaque élément coûte une transaction DB **et**
 * un ou plusieurs appels MinIO : vider d'un coup la corbeille d'un long-métrage occuperait
 * le worker des heures et martèlerait le stockage pendant que le studio travaille. La purge
 * est idempotente et reprend là où elle s'est arrêtée à la passe suivante.
 */
export const TRASH_PURGE_MAX_ITEMS = 2000;

/**
 * Purge définitivement tout élément en corbeille depuis plus de `retentionDays` jours, dans
 * la limite de `maxItems` éléments par passe.
 * `retentionDays <= 0` désactive la purge automatique (no-op).
 * Ordre : enfants avant parents pour éviter les conflits de cascade.
 */
export async function purgeExpiredTrash(
  retentionDays: number,
  maxItems: number = TRASH_PURGE_MAX_ITEMS,
): Promise<number> {
  if (!retentionDays || retentionDays <= 0) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const expired = { deletedAt: { lt: cutoff, not: null } } as const;
  let budget = Math.max(0, Math.trunc(maxItems));
  let purged = 0;

  /** Consomme le budget restant sur un niveau de la hiérarchie, du plus ancien au plus récent. */
  const sweep = async (
    find: (take: number) => Promise<{ id: number }[]>,
    purgeOne: (id: number) => Promise<void>,
  ): Promise<void> => {
    if (budget <= 0) return;
    for (const row of await find(budget)) {
      await purgeOne(row.id);
      purged += 1;
      budget -= 1;
    }
  };

  const page = { where: expired, select: { id: true }, orderBy: { id: 'asc' } } as const;
  await sweep((take) => prisma.mediaObject.findMany({ ...page, take }), purgeMedia);
  await sweep((take) => prisma.version.findMany({ ...page, take }), purgeVersion);
  await sweep((take) => prisma.shot.findMany({ ...page, take }), purgeShot);
  await sweep((take) => prisma.sequence.findMany({ ...page, take }), purgeSequence);
  // Après les séquences : elles ne dépendent pas de leur épisode (SetNull), mais l'ordre
  // enfants → parents reste la règle du balayage.
  await sweep((take) => prisma.episode.findMany({ ...page, take }), purgeEpisode);
  await sweep((take) => prisma.asset.findMany({ ...page, take }), purgeAsset);
  await sweep((take) => prisma.project.findMany({ ...page, take }), purgeProject);

  return purged;
}
