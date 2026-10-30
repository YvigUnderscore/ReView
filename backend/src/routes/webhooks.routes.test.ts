// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const { admin, deliveries, logAudit, caller } = vi.hoisted(() => {
  const caller: { user: Request['user'] } = { user: { id: 1, email: 'a@b.c', role: 'ADMIN' } };
  return {
    admin: {
      getHook: vi.fn(),
      listHooks: vi.fn(),
      createHook: vi.fn(),
      updateHook: vi.fn(),
      deleteHook: vi.fn(),
    },
    deliveries: { listDeliveries: vi.fn(), queueDelivery: vi.fn(), replayDelivery: vi.fn() },
    logAudit: vi.fn(),
    caller,
  };
});

vi.mock('../middleware/auth', async () => ({
  ...(await import('../middleware/authUser')),
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = caller.user;
    next();
  },
}));
vi.mock('../services/WebhookAdminService', () => admin);
vi.mock('../services/WebhookService', () => deliveries);
vi.mock('../services/AuditService', () => ({ logAudit }));

import express from 'express';
import request from 'supertest';
import webhooksRoutes from './webhooks.routes';
import { errorHandler } from '../middleware/error';
import { notFound } from '../lib/errors';

const app = express().use(express.json()).use('/api/admin/webhooks', webhooksRoutes).use(errorHandler);
const hook = { id: 4, url: 'https://hooks.example/x', active: true };

beforeEach(() => {
  vi.clearAllMocks();
  caller.user = { id: 1, email: 'a@b.c', role: 'ADMIN' };
  admin.getHook.mockResolvedValue(hook);
});

describe('webhooks administration routes', () => {
  it('is reserved to administrators', async () => {
    caller.user = { id: 2, email: 's@b.c', role: 'SUPERVISOR' };
    expect((await request(app).get('/api/admin/webhooks')).status).toBe(403);
    expect(admin.listHooks).not.toHaveBeenCalled();
  });

  it('lists the webhooks', async () => {
    admin.listHooks.mockResolvedValue([hook]);
    const res = await request(app).get('/api/admin/webhooks');
    expect(res.body).toEqual({ webhooks: [hook] });
  });

  it('creates a webhook from a valid body, the secret shown once', async () => {
    admin.createHook.mockResolvedValue({ webhook: hook, secret: 's3cr3t' });
    const body = { url: 'https://hooks.example/x', events: ['media.published'] };
    const res = await request(app).post('/api/admin/webhooks').send(body);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ webhook: hook, secret: 's3cr3t' });
    expect(admin.createHook).toHaveBeenCalledWith(1, body);
  });

  it('refuses an event that is never emitted', async () => {
    const res = await request(app)
      .post('/api/admin/webhooks')
      .send({ url: 'https://hooks.example/x', events: ['nope'] });
    expect(res.status).toBe(400);
    expect(admin.createHook).not.toHaveBeenCalled();
  });

  it('updates and deletes', async () => {
    admin.updateHook.mockResolvedValue({ ...hook, active: false });
    const patched = await request(app).patch('/api/admin/webhooks/4').send({ active: false });
    expect(patched.body).toEqual({ webhook: { ...hook, active: false } });
    expect(admin.updateHook).toHaveBeenCalledWith(1, 4, { active: false });
    expect((await request(app).delete('/api/admin/webhooks/4')).status).toBe(204);
    expect(admin.deleteHook).toHaveBeenCalledWith(1, 4);
  });

  it('queues a signed test delivery', async () => {
    deliveries.queueDelivery.mockResolvedValue(77);
    const res = await request(app).post('/api/admin/webhooks/4/test');
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ queued: true, deliveryId: 77 });
    expect(deliveries.queueDelivery).toHaveBeenCalledWith(
      4,
      'test',
      expect.objectContaining({ requestedBy: 1 }),
    );
  });

  it('pages the delivery log', async () => {
    deliveries.listDeliveries.mockResolvedValue({ items: [] });
    await request(app).get('/api/admin/webhooks/4/deliveries?limit=10&before=50');
    expect(deliveries.listDeliveries).toHaveBeenCalledWith(4, 10, 50);
    await request(app).get('/api/admin/webhooks/4/deliveries');
    expect(deliveries.listDeliveries).toHaveBeenLastCalledWith(4, 25, undefined);
  });

  it('an unknown webhook is a 404 everywhere', async () => {
    admin.getHook.mockRejectedValue(notFound('Webhook not found'));
    expect((await request(app).post('/api/admin/webhooks/9/test')).status).toBe(404);
    expect((await request(app).get('/api/admin/webhooks/9/deliveries')).status).toBe(404);
  });
});

describe('replaying a delivery', () => {
  it('replays a lost delivery and audits it', async () => {
    deliveries.replayDelivery.mockResolvedValue(81);
    const res = await request(app).post('/api/admin/webhooks/4/deliveries/12/replay');
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ queued: true, deliveryId: 81 });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WEBHOOK_REPLAY', metadata: { replayOf: 12, deliveryId: 81 } }),
    );
  });

  it('refuses to replay towards a disabled webhook', async () => {
    admin.getHook.mockResolvedValue({ ...hook, active: false });
    const res = await request(app).post('/api/admin/webhooks/4/deliveries/12/replay');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('WEBHOOK_INACTIVE');
    expect(deliveries.replayDelivery).not.toHaveBeenCalled();
  });

  it('an unknown delivery is a 404', async () => {
    deliveries.replayDelivery.mockResolvedValue(null);
    expect((await request(app).post('/api/admin/webhooks/4/deliveries/12/replay')).status).toBe(404);
    expect(logAudit).not.toHaveBeenCalled();
  });
});
