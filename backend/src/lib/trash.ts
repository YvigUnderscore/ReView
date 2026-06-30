import { prisma } from './prisma';
import { storage } from '../services/StorageService';

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

/** Supprime les objets MinIO (média + miniature) en best-effort. */
async function deleteMediaObjects(medias: MediaKeys[]): Promise<void> {
  for (const m of medias) {
    if (m.storageKey) await storage.deleteObject(m.storageKey).catch(() => undefined);
    if (m.thumbnailKey) await storage.deleteObject(m.thumbnailKey).catch(() => undefined);
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

// ── Purge définitive (DB + MinIO) ────────────────────────────────────────────────

export async function purgeMedia(id: number): Promise<void> {
  const media = await prisma.mediaObject.findUnique({
    where: { id },
    select: { storageKey: true, thumbnailKey: true },
  });
  if (!media) return;
  await deleteMediaObjects([media]);
  await prisma.mediaObject.delete({ where: { id } });
}

export async function purgeVersion(id: number): Promise<void> {
  const medias = await prisma.mediaObject.findMany({
    where: { versionId: id },
    select: { storageKey: true, thumbnailKey: true },
  });
  await deleteMediaObjects(medias);
  await prisma.version.delete({ where: { id } }); // cascade DB des médias
}

export async function purgeShot(id: number): Promise<void> {
  const medias = await prisma.mediaObject.findMany({
    where: { version: { task: { shotId: id } } },
    select: { storageKey: true, thumbnailKey: true },
  });
  await deleteMediaObjects(medias);
  await prisma.shot.delete({ where: { id } }); // cascade DB : tasks → versions → médias
}

export async function purgeAsset(id: number): Promise<void> {
  const medias = await prisma.mediaObject.findMany({
    where: { version: { OR: [{ assetId: id }, { task: { assetId: id } }] } },
    select: { storageKey: true, thumbnailKey: true },
  });
  await deleteMediaObjects(medias);
  await prisma.asset.delete({ where: { id } });
}

export async function purgeSequence(id: number): Promise<void> {
  // La suppression d'une séquence remet sequenceId à null sur ses shots (SetNull) :
  // aucun média à purger ici.
  await prisma.sequence.delete({ where: { id } });
}

export async function purgeProject(id: number): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id }, select: { slug: true } });
  if (!project) return;
  // Nouvelles clés lisibles + anciennes clés numériques (legacy).
  await storage.deletePrefix(`projects/${project.slug}/`).catch(() => undefined);
  await storage.deletePrefix(`projects/${id}/`).catch(() => undefined);
  await prisma.project.delete({ where: { id } }); // cascade DB intégrale
}

// ── Purge automatique (balayage planifié) ────────────────────────────────────────

/**
 * Purge définitivement tout élément en corbeille depuis plus de `retentionDays` jours.
 * `retentionDays <= 0` désactive la purge automatique (no-op).
 * Ordre : enfants avant parents pour éviter les conflits de cascade.
 */
export async function purgeExpiredTrash(retentionDays: number): Promise<number> {
  if (!retentionDays || retentionDays <= 0) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const expired = { deletedAt: { lt: cutoff, not: null } } as const;
  let purged = 0;

  const media = await prisma.mediaObject.findMany({ where: expired, select: { id: true } });
  for (const m of media) { await purgeMedia(m.id); purged++; }

  const versions = await prisma.version.findMany({ where: expired, select: { id: true } });
  for (const v of versions) { await purgeVersion(v.id); purged++; }

  const shots = await prisma.shot.findMany({ where: expired, select: { id: true } });
  for (const s of shots) { await purgeShot(s.id); purged++; }

  const sequences = await prisma.sequence.findMany({ where: expired, select: { id: true } });
  for (const s of sequences) { await purgeSequence(s.id); purged++; }

  const assets = await prisma.asset.findMany({ where: expired, select: { id: true } });
  for (const a of assets) { await purgeAsset(a.id); purged++; }

  const projects = await prisma.project.findMany({ where: expired, select: { id: true } });
  for (const p of projects) { await purgeProject(p.id); purged++; }

  return purged;
}
