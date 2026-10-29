// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';

/**
 * A user's notification inbox: reading and acknowledging. Producing notifications lives in
 * `NotificationService`.
 */

/** Most recent notifications (capped at 100) and the unread count. */
export async function listInbox(userId: number) {
  const [notifications, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);
  return { notifications, unread };
}

/** Marks one of the user's notifications as read; someone else's is a 404. */
export async function markRead(userId: number, id: number) {
  const notif = await prisma.notification.findFirst({ where: { id, userId } });
  if (!notif) throw notFound('Notification not found');
  return prisma.notification.update({ where: { id }, data: { isRead: true } });
}

/** Marks all the user's notifications as read. */
export async function markAllRead(userId: number): Promise<void> {
  await prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
}
