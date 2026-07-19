import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { checkProjectAccess } from '../middleware/rbac';
import { resolveProjectIdForMedia } from '../lib/pipeline';
import { displayName } from '../lib/userView';
import { emitToReview } from './SocketService';

/**
 * Marqueurs de timeline nommés/colorés partagés (Phase 34.C) : posés par clic droit sur
 * la timeline vidéo, visibles par tous les membres du projet. Création par les rôles
 * d'écriture ; modification/suppression par l'auteur ou un superviseur. Chaque mutation
 * notifie la room de review (`markers:changed`) pour invalidation temps réel.
 */

type SessionUser = { id: number; role: Role };

const MAX_MARKERS = 500;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

export interface TimelineMarkerView {
  id: number;
  frame: number;
  name: string;
  color: string;
  authorId: number | null;
  authorName: string | null;
  createdAt: Date;
}

const AUTHOR_SELECT = {
  select: { id: true, email: true, name: true, firstName: true, lastName: true, username: true },
} as const;

const toView = (m: {
  id: number;
  frame: number;
  name: string;
  color: string;
  authorId: number | null;
  createdAt: Date;
  author: {
    id: number;
    email: string;
    name: string | null;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
  } | null;
}): TimelineMarkerView => ({
  id: m.id,
  frame: m.frame,
  name: m.name,
  color: m.color,
  authorId: m.authorId,
  authorName: m.author ? displayName(m.author) : null,
  createdAt: m.createdAt,
});

/** Accès lecture au média (membre du projet) — renvoie le projectId. */
async function assertMediaRead(mediaId: number, user: SessionUser): Promise<number> {
  const projectId = await resolveProjectIdForMedia(mediaId);
  if (!projectId) throw notFound('Média introuvable');
  if (!(await checkProjectAccess(user.id, user.role, projectId))) throw forbidden('Accès au projet refusé');
  return projectId;
}

const canWrite = (role: Role) => role === Role.ADMIN || role === Role.SUPERVISOR || role === Role.ARTIST;

export async function list(user: SessionUser, mediaId: number): Promise<TimelineMarkerView[]> {
  await assertMediaRead(mediaId, user);
  const markers = await prisma.timelineMarker.findMany({
    where: { mediaObjectId: mediaId },
    orderBy: { frame: 'asc' },
    include: { author: AUTHOR_SELECT },
  });
  return markers.map(toView);
}

export async function create(
  user: SessionUser,
  mediaId: number,
  data: { frame: number; name: string; color: string },
): Promise<TimelineMarkerView> {
  if (!canWrite(user.role)) throw forbidden('Création de marqueur réservée aux rôles d’écriture');
  await assertMediaRead(mediaId, user);
  if (!COLOR_RE.test(data.color)) throw badRequest('Couleur invalide (hex #rrggbb attendu)');
  const count = await prisma.timelineMarker.count({ where: { mediaObjectId: mediaId } });
  if (count >= MAX_MARKERS) throw badRequest('Trop de marqueurs sur ce média');
  const marker = await prisma.timelineMarker.create({
    data: {
      mediaObjectId: mediaId,
      frame: data.frame,
      name: data.name,
      color: data.color,
      authorId: user.id,
    },
    include: { author: AUTHOR_SELECT },
  });
  emitToReview(mediaId, 'markers:changed', { mediaId });
  return toView(marker);
}

/** L'auteur ou un superviseur/admin peut modifier/supprimer un marqueur. */
async function assertMarkerManage(user: SessionUser, mediaId: number, markerId: number) {
  await assertMediaRead(mediaId, user);
  const marker = await prisma.timelineMarker.findUnique({ where: { id: markerId } });
  if (!marker || marker.mediaObjectId !== mediaId) throw notFound('Marqueur introuvable');
  const manager = user.role === Role.ADMIN || user.role === Role.SUPERVISOR;
  if (!manager && marker.authorId !== user.id)
    throw forbidden('Modification réservée à l’auteur ou un superviseur');
  return marker;
}

export async function update(
  user: SessionUser,
  mediaId: number,
  markerId: number,
  data: { frame?: number; name?: string; color?: string },
): Promise<TimelineMarkerView> {
  await assertMarkerManage(user, mediaId, markerId);
  if (data.color !== undefined && !COLOR_RE.test(data.color))
    throw badRequest('Couleur invalide (hex #rrggbb attendu)');
  const marker = await prisma.timelineMarker.update({
    where: { id: markerId },
    data,
    include: { author: AUTHOR_SELECT },
  });
  emitToReview(mediaId, 'markers:changed', { mediaId });
  return toView(marker);
}

export async function remove(user: SessionUser, mediaId: number, markerId: number): Promise<void> {
  await assertMarkerManage(user, mediaId, markerId);
  await prisma.timelineMarker.delete({ where: { id: markerId } });
  emitToReview(mediaId, 'markers:changed', { mediaId });
}
