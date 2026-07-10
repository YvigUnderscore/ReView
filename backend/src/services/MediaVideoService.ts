import { MediaKind, MediaStatus, Prisma } from '@prisma/client';
import { badRequest, notFound } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { enqueueMediaJob } from './JobService';
import { assertMediaManage } from './MediaService';
import { storage } from './StorageService';

/**
 * Retouches vidéo non-destructives (10.G-V10) : trim in/out en frames — `metadata.trim` +
 * **proxy trimé** produit par le worker FFmpeg (`metadata.trimProxyKey`), le fichier original
 * n'est jamais modifié. Gestionnaires ; autorisé même publié (marqueur « modifié après
 * publication » posé, comme les éditions splat).
 */

type SessionUser = { id: number; role: import('@prisma/client').Role };

export interface TrimInput {
  inFrame: number;
  outFrame: number;
}

/** Marqueur « modifié après publication » (fusionné au metadata si le média est publié). */
function editedMarker(user: SessionUser, media: { published: boolean }) {
  return media.published
    ? { editedAfterPublishAt: new Date().toISOString(), editedAfterPublishById: user.id }
    : {};
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

  const meta: Record<string, unknown> = {
    ...((media.metadata ?? {}) as Record<string, unknown>),
    ...editedMarker(user, media),
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
    ...editedMarker(user, media),
  };
}
