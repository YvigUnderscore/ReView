// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaStatus, Prisma, type Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';
import { createUpload, type CreateUploadInput, mediaSourceKey } from './MediaService';
import { logAudit } from './AuditService';
import { badRequest, notFound } from '../lib/errors';
import { discardUploadObjects } from '../lib/staleUploads';

type SessionUser = { id: number; role: Role };

/**
 * Restricts a `MediaObject` query to the projects visible to the caller.
 * ADMIN and SUPERVISOR have global access (see `middleware/rbac`); the others go through their
 * `ProjectMembership`. A media attaches to a project through three possible paths
 * (shot task, asset task, or direct asset), hence the three branches.
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
 * Resumable multipart upload + deduplication by content hash (37.A/37.B).
 *
 * Stateless resumption on the client side: `init` finds an interrupted multipart upload (same
 * uploader/version/name/hash) and returns the parts already received (S3 ListParts being
 * the source of truth). Deduplication: if a READY media with the same sha256+size exists and its source
 * object is still present, the object is copied server-side ("instant upload").
 */

/** Default part size (S3 minimum: 5 MB). Communicated to the client by `init`. */
export const MULTIPART_PART_SIZE = 16 * 1024 * 1024;
/**
 * Number of parts beyond which the control traffic alone (signatures, ListParts, Complete) becomes costly: a
 * 20 GB master cut into 16 MB chunks would make 1,250 parts.
 */
const MAX_PARTS = 1000;

/**
 * Splitting a file: 16 MB, enlarged to the next MB beyond 16 GB to stay under `MAX_PARTS`. A
 * **deterministic** function of the size: a resumption finds exactly the split of the
 * initial upload, even without metadata.
 */
export function partSizeFor(size: number): number {
  const mb = 1024 * 1024;
  if (size <= MULTIPART_PART_SIZE * MAX_PARTS) return MULTIPART_PART_SIZE;
  return Math.ceil(size / MAX_PARTS / mb) * mb;
}

type Meta = Record<string, unknown>;

export async function initMultipart(user: SessionUser, input: CreateUploadInput & { size: number }) {
  // Resumption: an interrupted multipart upload of the same file by the same account?
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
          // The split of the initial upload is authoritative: recomputing it would change the part boundaries
          // and make those already received unusable.
          partSize:
            typeof meta.multipartPartSize === 'number' ? meta.multipartPartSize : partSizeFor(input.size),
          resumed: true,
          uploadedParts,
        };
      } catch {
        // UploadId expired/aborted on the MinIO side: we start from scratch (row cleaned up below). The abort
        // is attempted BEFORE the row is deleted: `listUploadedParts` also fails on a passing MinIO incident,
        // and the multipart is then still alive — the row gone, its `uploadId` would be nowhere and its parts
        // would stay on disk forever. If the upload has really disappeared, the abort fails and costs
        // nothing.
        await storage.abortMultipartUpload(pending.storageKey, meta.multipartUploadId).catch(() => undefined);
        await prisma.mediaObject.delete({ where: { id: pending.id } }).catch(() => undefined);
      }
    }

    // Deduplication (37.B): the same content already present (source still there) → server-side copy.
    // Bounded to the projects the caller has access to: without this filter, the search for the twin swept
    // the whole instance, and a known fingerprint was enough to have the
    // bytes of another project copied — and to learn that a given content exists there.
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
            metadata: { contentHash: input.contentHash, dedupFrom: twin.id },
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
          partSize: partSizeFor(input.size),
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
  const partSize = partSizeFor(input.size);
  await prisma.mediaObject.update({
    where: { id: created.mediaObjectId },
    data: {
      metadata: {
        ...((media?.metadata ?? {}) as Meta),
        multipartUploadId: uploadId,
        multipartPartSize: partSize,
      },
    },
  });
  return {
    mediaObjectId: created.mediaObjectId,
    partSize,
    uploadedParts: [],
    namingWarning: created.namingWarning,
  };
}

/** Loads a multipart media belonging to the caller, still being uploaded. */
async function loadOwnMultipart(user: SessionUser, id: number) {
  const media = await prisma.mediaObject.findFirst({
    where: { id, uploaderId: user.id, status: MediaStatus.UPLOADING },
  });
  if (!media) throw notFound('Upload not found');
  const uploadId = (media.metadata as Meta).multipartUploadId;
  if (typeof uploadId !== 'string') throw badRequest('This media is not a multipart upload');
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
  delete meta.multipartPartSize;
  await prisma.mediaObject.update({
    where: { id },
    data: { metadata: meta as Prisma.InputJsonValue },
  });
  return { completed: true };
}

/**
 * Abandons an upload in progress, whatever its path.
 *
 * The client's "cancel" button ends up here. The sorting of the three deposit paths (multipart to abort,
 * frame prefix to empty, truncated object to delete) lives in `lib/staleUploads.discardUploadObjects`, shared
 * with the purge of abandoned uploads: both delete the same `MediaObject` row, they must erase the same
 * bytes.
 */
export async function abortUpload(user: SessionUser, id: number) {
  const media = await prisma.mediaObject.findFirst({
    where: { id, uploaderId: user.id, status: MediaStatus.UPLOADING },
    include: { imageSequence: true },
  });
  if (!media) throw notFound('Upload not found');
  await discardUploadObjects(media);
  await prisma.mediaObject.delete({ where: { id } });
  return { aborted: true };
}
