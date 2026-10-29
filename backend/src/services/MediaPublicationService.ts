// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind, MediaStatus, VersionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { resolveProjectIdForVersion } from '../lib/pipeline';
import { logAudit } from './AuditService';
import { emitToProject } from './SocketService';
import { publish as publishApiEvent } from './ApiEventService';
import { notifyChat } from './ChatNotifyService';
import { badRequest, notFound } from '../lib/errors';
import { shouldPublishVersion } from '../lib/publishState';
import { notifyWatchers } from './WatchService';
import { listReviewers, setReviewers, type ReviewerInput } from './ReviewAssignmentService';
import { enqueuePush } from './shotgrid/ShotgridPushService';
import { serializeMedia, type SessionUser } from './mediaShared';

/** Publication of a media and of its version, and the announcement that goes with it. */

/**
 * Aligns a version's published state with that of its media (rules in `lib/publishState`).
 *
 * Called after each media publication. Never unpublishes: withdrawing a version from
 * distribution remains a supervisor decision, not a side effect of a deletion.
 */
export async function syncVersionPublication(versionId: number, actorId: number): Promise<boolean> {
  const version = await prisma.version.findUnique({
    where: { id: versionId },
    select: {
      published: true,
      media: { where: { deletedAt: null }, select: { published: true, status: true } },
    },
  });
  if (!version || version.published) return false;
  if (!shouldPublishVersion(version.media)) return false;

  await prisma.version.update({
    where: { id: versionId },
    data: { published: true, status: VersionStatus.PUBLISHED },
  });
  logAudit({
    userId: actorId,
    action: 'VERSION_PUBLISH',
    entityType: 'Version',
    entityId: versionId,
  });
  return true;
}

/**
 * Publishes a draft media (reserved to the uploader): the gesture of draft mode.
 *
 * Outside draft mode (the default since Phase 50) the media already arrives published. The
 * route still serves studios that kept drafts, and API v1, whose finalize goes through it. It
 * then republishes nothing; see the guard below.
 *
 * `reviewers` is the gesture of the upload: "publish, and here is who must look at what". The
 * list is written on the VERSION (it is what gets assigned), BEFORE the switch: that gives
 * meaning to the project setting "mandatory brief", which then refuses publication instead of
 * letting it go out and complaining afterwards. When absent, the list already set is left as is:
 * publishing does not undo what was assigned.
 *
 * Returns the media AND the list, so the screen can update without re-reading the media; that
 * re-read would re-sign all its URLs and reload the viewer.
 */
export async function publish(user: SessionUser, id: number, reviewers?: ReviewerInput[]) {
  const media = await prisma.mediaObject.findUnique({ where: { id } });
  if (!media) throw notFound('Media not found');
  // Strictly private draft: only the uploader sees and publishes their media (404 otherwise).
  if (media.uploaderId !== user.id) throw notFound('Media not found');
  // A media still UPLOADING has never gone through `finalize`: no magic-byte validation, no
  // content-type normalization, no antivirus, no check of the real size against quotas.
  // Publishing it would serve unverified content.
  if (media.status === MediaStatus.UPLOADING) throw badRequest('Upload not finalised', 'NOT_FINALIZED');
  if (reviewers !== undefined) {
    // An explicitly requested list is not lost silently: a version detached from any project
    // has nobody to assign it to, and saying so is better than publishing as if nothing happened.
    const owner = await resolveProjectIdForVersion(media.versionId);
    if (!owner) throw notFound('Version not attached to a project');
    await setReviewers(user, owner, media.versionId, reviewers);
  }
  // A media already published (which is every upload outside draft mode) is not republished:
  // the requested list is written and we stop there. Without this guard the API v1 path
  // (`PublishFlowService.complete`) would announce the same delivery twice: two webhooks, two
  // follower notifications, two ShotGrid sends.
  const alreadyPublished = media.published;
  const updated = alreadyPublished
    ? media
    : await prisma.mediaObject.update({ where: { id }, data: { published: true } });
  if (!alreadyPublished)
    await announcePublication(updated, await resolveProjectIdForVersion(media.versionId), user.id);
  return { media: serializeMedia(updated), reviewers: await listReviewers(media.versionId) };
}

/**
 * What follows a media publication, wherever it comes from.
 *
 * Extracted from `publish` because there are now TWO doors: the explicit gesture in draft
 * mode, and the upload finalization, which publishes automatically. Leaving the second one
 * without these effects would give media visible to everyone while the version stays "draft",
 * with followers never hearing about it and ShotGrid never receiving it.
 *
 * `projectId` may be missing (detached version): the version still follows its media, but
 * there is nobody to notify.
 */
export async function announcePublication(
  media: { id: number; versionId: number; kind: MediaKind; originalName: string },
  projectId: number | null,
  actorId: number,
): Promise<void> {
  const { id, versionId, originalName } = media;
  // The version follows its media: as soon as no draft remains, it is published.
  await syncVersionPublication(versionId, actorId);
  if (!projectId) return;
  emitToProject(projectId, 'media:update', { projectId, id, versionId });
  // 48: the version is sent to ShotGrid: created if unknown there, otherwise the media is added
  // to the existing version. A media added along the way must not create a duplicate with the
  // same name.
  await enqueuePush(projectId, { type: 'version-publish', versionId, actorId });
  // Followers (32.G): publication on the version/shot/asset chain.
  await notifyWatchers({
    mediaObjectId: id,
    projectId,
    messageKey: 'notification.mediaPublished',
    params: { name: originalName },
    exclude: [actorId],
  });
  // Outgoing webhooks (36.D).
  publishApiEvent('media.published', {
    projectId,
    entityType: 'media',
    entityId: id,
    actorId,
    payload: {
      mediaObjectId: id,
      versionId,
      projectId,
      kind: media.kind,
      originalName,
      publishedBy: actorId,
    },
  });
  // Team messaging (42.B, #67).
  void notifyChat('chat.mediaPublished', { name: originalName });
}
