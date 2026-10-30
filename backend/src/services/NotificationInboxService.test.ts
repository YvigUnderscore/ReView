// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    notification: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));
vi.mock('../lib/prisma', () => ({ prisma: db }));

import { listInbox, markAllRead, markRead } from './NotificationInboxService';

beforeEach(() => vi.clearAllMocks());

describe('NotificationInboxService', () => {
  it('lists the latest 100 and counts the unread, for that user only', async () => {
    db.notification.findMany.mockResolvedValue([{ id: 1 }]);
    db.notification.count.mockResolvedValue(4);
    expect(await listInbox(7)).toEqual({ notifications: [{ id: 1 }], unread: 4 });
    expect(db.notification.findMany).toHaveBeenCalledWith({
      where: { userId: 7 },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    expect(db.notification.count).toHaveBeenCalledWith({ where: { userId: 7, isRead: false } });
  });

  it("marks one of the user's notifications read; someone else's is a 404", async () => {
    db.notification.findFirst.mockResolvedValueOnce({ id: 3 });
    db.notification.update.mockResolvedValue({ id: 3, isRead: true });
    expect(await markRead(7, 3)).toEqual({ id: 3, isRead: true });
    db.notification.findFirst.mockResolvedValueOnce(null);
    await expect(markRead(7, 4)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('marks everything read', async () => {
    await markAllRead(7);
    expect(db.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 7, isRead: false },
      data: { isRead: true },
    });
  });
});
