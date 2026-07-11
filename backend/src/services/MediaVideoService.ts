import { MediaKind, MediaStatus, Prisma } from '@prisma/client';
import { badRequest, notFound } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { assertNotPublished } from '../lib/publishLock';
import { enqueueMediaJob } from './JobService';
import { assertMediaManage } from './MediaService';
import { storage } from './StorageService';

/**
 * Retouches vidéo non-destructives (10.G-V10) : trim in/out en frames — `metadata.trim` +
 * **proxy trimé** produit par le worker FFmpeg (`metadata.trimProxyKey`), le fichier original
 * n'est jamais modifié. Gestionnaires, **vidéo non publiée uniquement** (verrou Phase 11).
 */

type SessionUser = { id: number; role: import('@prisma/client').Role };

export interface TrimInput {
  inFrame: number;
  outFrame: number;
}

/** Enregistre (ou efface si null) le trim — le worker produit ensuite le proxy trimé. */
export async function setTrim(user: SessionUser, id: number, trim: TrimInput | null) {
  await assertMediaManage(id, user);
  const media = await prisma.mediaObject.findUnique({
    where: { id },
    select: { metadata: true, kind: true, published: true, status: true },
  });
  if (!media) throw notFound('Média introuvable');
  if (media.kind !== MediaKind.VIDEO) throw badRequest('Trim réservé aux vidéos', 'NOT_VIDEO');
  if (media.status !== MediaStatus.READY)
    throw badRequest('Vidéo pas encore prête (traitement en cours)', 'NOT_READY');
  assertNotPublished(media);

  const meta: Record<string, unknown> = {
    ...((media.metadata ?? {}) as Record<string, unknown>),
  };
  // L'ancien proxy trimé ne correspond plus (nouvelle coupe ou retrait) : purgé tout de suite,
  // le worker en produira un frais si un trim est posé.
  const oldTrimProxy = typeof meta.trimProxyKey === 'string' ? meta.trimProxyKey : null;
  delete meta.trimProxyKey;
  if (trim) meta.trim = { inFrame: trim.inFrame, outFrame: trim.outFrame };
  else delete meta.trim;

  await prisma.mediaObject.update({
    where: { id },
    data: { metadata: meta as Prisma.InputJsonObject },
  });
  if (oldTrimProxy) await storage.deleteObject(oldTrimProxy).catch(() => undefined);
  if (trim) await enqueueMediaJob({ mediaObjectId: id, kind: 'trim' });
  return {
    trim: trim ? { inFrame: trim.inFrame, outFrame: trim.outFrame } : null,
    trimProxyReady: false,
  };
}
