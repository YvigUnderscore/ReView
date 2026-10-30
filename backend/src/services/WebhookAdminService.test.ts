// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, logAudit, allowed } = vi.hoisted(() => ({
  db: {
    project: { findUnique: vi.fn() },
    webhook: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
  logAudit: vi.fn(),
  allowed: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./AuditService', () => ({ logAudit }));
vi.mock('../lib/webhooks', () => ({ isWebhookUrlAllowed: allowed }));
vi.mock('../lib/crypto', () => ({ encryptSecret: (s: string) => `enc:${s}` }));

import { createHook, deleteHook, getHook, hookSelect, listHooks, updateHook } from './WebhookAdminService';

const hook = { id: 4, url: 'https://hooks.example/x', active: false };

beforeEach(() => {
  vi.clearAllMocks();
  allowed.mockReturnValue(true);
  db.project.findUnique.mockResolvedValue({ id: 3 });
  db.webhook.findUnique.mockResolvedValue(hook);
  db.webhook.create.mockImplementation(async ({ data }) => ({ id: 4, ...data }));
  db.webhook.update.mockImplementation(async ({ data }) => ({ ...hook, ...data }));
});

describe('getHook / listHooks', () => {
  it('never selects the secret', async () => {
    expect(hookSelect).not.toHaveProperty('secret');
    await getHook(4);
    expect(db.webhook.findUnique).toHaveBeenCalledWith({ where: { id: 4 }, select: hookSelect });
    db.webhook.findMany.mockResolvedValue([hook]);
    expect(await listHooks()).toEqual([hook]);
  });

  it('an unknown webhook is a 404', async () => {
    db.webhook.findUnique.mockResolvedValue(null);
    await expect(getHook(9)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('createHook', () => {
  it('stores the secret encrypted and returns it in clear once, audited', async () => {
    const { webhook, secret } = await createHook(1, {
      url: 'https://hooks.example/x',
      events: ['a'],
      projectId: 3,
    });
    expect(secret).toMatch(/^[0-9a-f]{48}$/);
    expect(db.webhook.create.mock.calls[0]![0].data).toEqual({
      url: 'https://hooks.example/x',
      events: ['a'],
      projectId: 3,
      secret: `enc:${secret}`,
    });
    expect(webhook.id).toBe(4);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'WEBHOOK_CREATE', entityId: 4 }));
  });

  it('refuses an internal URL and an unknown project', async () => {
    allowed.mockReturnValueOnce(false);
    await expect(createHook(1, { url: 'http://10.0.0.1', events: ['a'] })).rejects.toMatchObject({
      code: 'BAD_WEBHOOK_URL',
    });
    db.project.findUnique.mockResolvedValueOnce(null);
    await expect(createHook(1, { url: 'https://x', events: ['a'], projectId: 99 })).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(db.webhook.create).not.toHaveBeenCalled();
  });

  it('a studio-wide webhook has a null project', async () => {
    await createHook(1, { url: 'https://x', events: ['a'] });
    expect(db.webhook.create.mock.calls[0]![0].data.projectId).toBeNull();
    expect(db.project.findUnique).not.toHaveBeenCalled();
  });
});

describe('updateHook', () => {
  it('re-enabling clears the failure streak', async () => {
    await updateHook(1, 4, { active: true });
    expect(db.webhook.update.mock.calls[0]![0].data).toEqual({ active: true, failureStreak: 0 });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WEBHOOK_UPDATE', metadata: { active: true } }),
    );
  });

  it('other changes keep the streak', async () => {
    await updateHook(1, 4, { events: ['b'], active: false });
    expect(db.webhook.update.mock.calls[0]![0].data).toEqual({ events: ['b'], active: false });
  });
});

describe('deleteHook', () => {
  it('deletes and audits with the URL', async () => {
    await deleteHook(1, 4);
    expect(db.webhook.delete).toHaveBeenCalledWith({ where: { id: 4 } });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WEBHOOK_DELETE', metadata: { url: 'https://hooks.example/x' } }),
    );
  });
});
