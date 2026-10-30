// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { toPublicUser } from '../lib/userView';
import { getOnlineUserIds } from './PresenceService';
import { redactAuditMetadata } from './AuditService';

/**
 * Detailed record of an account for administration: full profile, projects (memberships + effective
 * role), active sessions, API tokens, recent activity (audit log) and contribution counters.
 */
export async function userDetail(id: number) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      firstName: true,
      lastName: true,
      username: true,
      jobTitle: true,
      bio: true,
      phone: true,
      avatarKey: true,
      role: true,
      status: true,
      lastSeenAt: true,
      storageUsed: true,
      storageLimit: true,
      totpEnabledAt: true,
      createdAt: true,
    },
  });
  if (!user) throw notFound('User not found');

  const [memberships, sessions, apiTokens, activity, mediaCount, versionCount, commentCount, taskCount] =
    await Promise.all([
      prisma.projectMembership.findMany({
        where: { userId: id },
        orderBy: { joinedAt: 'asc' },
        select: {
          id: true,
          role: true,
          joinedAt: true,
          project: { select: { id: true, name: true, slug: true, status: true, deletedAt: true } },
        },
      }),
      prisma.userSession.findMany({
        where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { lastSeenAt: 'desc' },
        select: { id: true, userAgent: true, ip: true, createdAt: true, lastSeenAt: true },
      }),
      prisma.apiToken.findMany({
        where: { userId: id, revokedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          scopes: true,
          lastUsedAt: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
      prisma.auditLog.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
          metadata: true,
        },
      }),
      prisma.mediaObject.count({ where: { uploaderId: id, deletedAt: null } }),
      prisma.version.count({ where: { authorId: id, deletedAt: null } }),
      prisma.comment.count({ where: { userId: id } }),
      prisma.task.count({ where: { assigneeId: id } }),
    ]);

  // `totpEnabledAt` is not returned as is: only a 2FA boolean is exposed.
  const { totpEnabledAt, ...publicFields } = user;

  /*
   * A5-03: this view returned the activity WITHOUT `metadata`, whereas the studio view now returns it:
   * "MEDIA_PURGE · MediaObject · 812" without saying which of the three hundred identifiers in the batch
   * had gone. The field therefore goes through the SAME redaction as the other view: without it, the
   * per-person screen would expose (webhook URLs, a secret slipped into an action's context) exactly what
   * the studio screen protects.
   */
  const redactedActivity = activity.map(({ metadata, ...row }) => ({
    ...row,
    metadata: redactAuditMetadata(metadata) ?? null,
  }));
  return {
    user: {
      ...(await toPublicUser(publicFields)),
      online: getOnlineUserIds().includes(id),
      twoFactorEnabled: totpEnabledAt != null,
    },
    memberships,
    sessions,
    apiTokens,
    activity: redactedActivity,
    counts: { media: mediaCount, versions: versionCount, comments: commentCount, tasks: taskCount },
  };
}
