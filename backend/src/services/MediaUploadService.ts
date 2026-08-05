// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaStatus, Prisma, type Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';
import { createUpload, type CreateUploadInput, mediaSourceKey } from './MediaService';
import { logAudit } from './AuditService';
import { badRequest, notFound } from '../lib/errors';

type SessionUser = { id: number; role: Role };

/**
 * Restreint une requête `MediaObject` aux projets visibles par l'appelant.
 * ADMIN et SUPERVISOR ont un accès global (cf. `middleware/rbac`) ; les autres passent par
 * leur `ProjectMembership`. Le média se rattache à un projet par trois chemins possibles
 * (tâche de shot, tâche d'asset, ou asset direct), d'où les trois branches.
 */
function accessibleMediaWhere(user: SessionUser): Prisma.MediaObjectWhereInput {
  if (user.role === 'ADMIN' || user.role === 'SUPERVISOR') return {};
  const project = { memberships: { some: { userId: user.id } } };
  return {
    version: {
      OR: [{ task: { shot: { project } } }, { task: { asset: { project } } }, { asset: { project } }],
    },
  };
}

/**
 * Upload résumable multipart + dédup par hash de contenu (37.A/37.B).
 *
 * Reprise sans état client : `init` retrouve un upload multipart interrompu (même
 * uploader/version/nom/hash) et renvoie les parts déjà reçues (ListParts S3 = source
 * de vérité). Dédup : si un média READY du même sha256+taille existe et que son objet
 * source est encore présent, l'objet est copié côté serveur (« upload instantané »).
 */

/** Taille de part (min S3 : 5 Mo). Communiquée au client par `init`. */
export const MULTIPART_PART_SIZE = 16 * 1024 * 1024;

type Meta = Record<string, unknown>;

export async function initMultipart(user: SessionUser, input: CreateUploadInput & { size: number }) {
  // Reprise : un upload multipart interrompu du même fichier par le même compte ?
  if (input.contentHash) {
    const pending = await prisma.mediaObject.findFirst({
      where: {
        uploaderId: user.id,
        versionId: input.versionId,
        originalName: input.filename,
        status: MediaStatus.UPLOADING,
        metadata: { path: ['contentHash'], equals: input.contentHash },
      },
    });
    const meta = (pending?.metadata ?? {}) as Meta;
    if (pending && typeof meta.multipartUploadId === 'string') {
      try {
        const uploadedParts = await storage.listUploadedParts(pending.storageKey, meta.multipartUploadId);
        return {
          mediaObjectId: pending.id,
          partSize: MULTIPART_PART_SIZE,
          resumed: true,
          uploadedParts,
        };
      } catch {
        // UploadId expiré/aborté côté MinIO : on repart de zéro (ligne nettoyée plus bas).
        await prisma.mediaObject.delete({ where: { id: pending.id } }).catch(() => undefined);
      }
    }

    // Dédup (37.B) : même contenu déjà présent (source encore là) → copie serveur.
    // Bornée aux projets auxquels l'appelant a accès : sans ce filtre, la recherche du
    // jumeau balayait toute l'instance, et une empreinte connue suffisait à faire recopier
    // les octets d'un autre projet — et à savoir qu'un contenu donné y existe.
    const twin = await prisma.mediaObject.findFirst({
      where: {
        status: MediaStatus.READY,
        size: BigInt(input.size),
        kind: input.kind,
        deletedAt: null,
        metadata: { path: ['contentHash'], equals: input.contentHash },
        ...accessibleMediaWhere(user),
      },
      orderBy: { id: 'desc' },
    });
    if (twin && (twin.metadata as Meta).sourceDeleted !== true) {
      const sourceKey = mediaSourceKey(twin);
      const exists = await storage
        .statObject(sourceKey)
        .then((s) => s.size === input.size)
        .catch(() => false);
      if (exists) {
        const created = await createUpload(user, input);
        await storage.copyObject(sourceKey, created.storageKey);
        await prisma.mediaObject.update({
          where: { id: created.mediaObjectId },
          data: {
            metadata: { contentHash: input.contentHash, dedupFrom: twin.id } as Prisma.InputJsonValue,
          },
        });
        logAudit({
          userId: user.id,
          action: 'MEDIA_DEDUP',
          entityType: 'MediaObject',
          entityId: created.mediaObjectId,
          metadata: { from: twin.id, bytesSaved: input.size },
        });
        return {
          mediaObjectId: created.mediaObjectId,
          partSize: MULTIPART_PART_SIZE,
          deduplicated: true,
          uploadedParts: [],
          namingWarning: created.namingWarning,
        };
      }
    }
  }

  const created = await createUpload(user, input);
  const media = await prisma.mediaObject.findUnique({ where: { id: created.mediaObjectId } });
  const uploadId = await storage.createMultipartUpload(created.storageKey, input.contentType);
  await prisma.mediaObject.update({
    where: { id: created.mediaObjectId },
    data: {
      metadata: {
        ...((media?.metadata ?? {}) as Meta),
        multipartUploadId: uploadId,
      } as Prisma.InputJsonValue,
    },
  });
  return {
    mediaObjectId: created.mediaObjectId,
    partSize: MULTIPART_PART_SIZE,
    uploadedParts: [],
    namingWarning: created.namingWarning,
  };
}

/** Charge un média multipart appartenant à l'appelant, encore en cours d'upload. */
async function loadOwnMultipart(user: SessionUser, id: number) {
  const media = await prisma.mediaObject.findFirst({
    where: { id, uploaderId: user.id, status: MediaStatus.UPLOADING },
  });
  if (!media) throw notFound('Upload introuvable');
  const uploadId = (media.metadata as Meta).multipartUploadId;
  if (typeof uploadId !== 'string') throw badRequest("Ce média n'est pas un upload multipart");
  return { media, uploadId };
}

export async function getPartUrls(user: SessionUser, id: number, partNumbers: number[]) {
  const { media, uploadId } = await loadOwnMultipart(user, id);
  return { urls: await storage.getPresignedPartUrls(media.storageKey, uploadId, partNumbers) };
}

export async function completeMultipart(
  user: SessionUser,
  id: number,
  parts: { partNumber: number; etag: string }[],
) {
  const { media, uploadId } = await loadOwnMultipart(user, id);
  await storage.completeMultipartUpload(media.storageKey, uploadId, parts);
  const meta = { ...(media.metadata as Meta) };
  delete meta.multipartUploadId;
  await prisma.mediaObject.update({
    where: { id },
    data: { metadata: meta as Prisma.InputJsonValue },
  });
  return { completed: true };
}

export async function abortMultipart(user: SessionUser, id: number) {
  const { media, uploadId } = await loadOwnMultipart(user, id);
  await storage.abortMultipartUpload(media.storageKey, uploadId).catch(() => undefined);
  await prisma.mediaObject.delete({ where: { id } });
  return { aborted: true };
}
