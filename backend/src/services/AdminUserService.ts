import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { toPublicUser } from '../lib/userView';
import { getOnlineUserIds } from './PresenceService';

/**
 * Fiche détaillée d'un compte pour l'administration : profil complet, projets
 * (memberships + rôle effectif), sessions actives, tokens d'API, activité récente
 * (journal d'audit) et compteurs de contribution.
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
  if (!user) throw notFound('Utilisateur introuvable');

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
        select: { id: true, action: true, entityType: true, entityId: true, createdAt: true },
      }),
      prisma.mediaObject.count({ where: { uploaderId: id, deletedAt: null } }),
      prisma.version.count({ where: { authorId: id, deletedAt: null } }),
      prisma.comment.count({ where: { userId: id } }),
      prisma.task.count({ where: { assigneeId: id } }),
    ]);

  // `totpEnabledAt` ne sort pas tel quel : on n'expose qu'un booléen 2FA.
  const { totpEnabledAt, ...publicFields } = user;
  return {
    user: {
      ...(await toPublicUser(publicFields)),
      online: getOnlineUserIds().includes(id),
      twoFactorEnabled: totpEnabledAt != null,
    },
    memberships,
    sessions,
    apiTokens,
    activity,
    counts: { media: mediaCount, versions: versionCount, comments: commentCount, tasks: taskCount },
  };
}
