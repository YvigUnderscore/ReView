// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { checkProjectAccess } from '../middleware/rbac';
import { resolveProjectIdForMedia } from '../lib/pipeline';
import { assertCanContribute, isProjectManager } from '../lib/projectRoles';
import { displayName } from '../lib/userView';
import { emitToReview } from './SocketService';

/**
 * Shared named and coloured timeline markers (Phase 34.C): placed by right-click on the video timeline, visible to all project members. Writing is reserved to
 * project contributors (EFFECTIVE role, see `lib/projectRoles`); modification and deletion by the author or a supervisor OF THIS PROJECT. Each mutation notifies the
 * review room (`markers:changed`) for real-time invalidation.
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

/** Read access to the media (project member) — returns the projectId. */
async function assertMediaRead(mediaId: number, user: SessionUser): Promise<number> {
  const projectId = await resolveProjectIdForMedia(mediaId);
  if (!projectId) throw notFound('Media not found');
  if (!(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('No access to this project');
  return projectId;
}

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
  const projectId = await assertMediaRead(mediaId, user);
    // 38.E: it is the EFFECTIVE role on THIS project that decides, not the global role. An ARTIST demoted to CLIENT keeps their membership (checkProjectAccess still says yes)
    // but no longer places a shared marker.
  await assertCanContribute(user.id, user.role, projectId);
  if (!COLOR_RE.test(data.color)) throw badRequest('Invalid colour (expected hex #rrggbb)');
  const count = await prisma.timelineMarker.count({ where: { mediaObjectId: mediaId } });
  if (count >= MAX_MARKERS) throw badRequest('Too many markers on this media');
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

/** The author or a supervisor/admin may modify/delete a marker. */
async function assertMarkerManage(user: SessionUser, mediaId: number, markerId: number) {
  const projectId = await assertMediaRead(mediaId, user);
  const marker = await prisma.timelineMarker.findUnique({ where: { id: markerId } });
  if (!marker || marker.mediaObjectId !== mediaId) throw notFound('Marker not found');
    // Same rule as at creation: without contribution rights on this project, shared markers are no longer touched — even by their author from before the demotion.
  await assertCanContribute(user.id, user.role, projectId);
  const manager = await isProjectManager(user.id, user.role, projectId);
  if (!manager && marker.authorId !== user.id)
    throw forbidden('Only the author or a supervisor can change this');
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
    throw badRequest('Invalid colour (expected hex #rrggbb)');
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
