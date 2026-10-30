// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const { inbox } = vi.hoisted(() => ({
  inbox: { listInbox: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn() },
}));
vi.mock('../middleware/auth', async () => ({
  ...(await import('../middleware/authUser')),
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 7, email: 'a@b.c', role: 'ARTIST' };
    next();
  },
}));
vi.mock('../services/NotificationInboxService', () => inbox);

import express from 'express';
import request from 'supertest';
import notificationsRoutes from './notifications.routes';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/notifications', notificationsRoutes).use(errorHandler);

beforeEach(() => vi.clearAllMocks());

describe('notifications routes', () => {
  it('lists the inbox of the caller', async () => {
    inbox.listInbox.mockResolvedValue({ notifications: [], unread: 0 });
    expect((await request(app).get('/api/notifications')).body).toEqual({ notifications: [], unread: 0 });
    expect(inbox.listInbox).toHaveBeenCalledWith(7);
  });

  it('marks one or all as read', async () => {
    inbox.markRead.mockResolvedValue({ id: 3 });
    expect((await request(app).patch('/api/notifications/3/read')).body).toEqual({ notification: { id: 3 } });
    expect(inbox.markRead).toHaveBeenCalledWith(7, 3);
    expect((await request(app).post('/api/notifications/read-all')).body).toEqual({ ok: true });
    expect(inbox.markAllRead).toHaveBeenCalledWith(7);
  });
});
