// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Audit E1 (2026-08-21): `POST /api/push/subscribe` accepted any URL, and `web-push` would then
 * POST to it from the application network, where MinIO, Redis, Postgres and 169.254.169.254
 * answer without network authentication. The primitive was open to any session, CLIENT included.
 * These tests pin the refusal, both at registration and at send time.
 */
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

vi.mock('../lib/prisma', () => ({
  prisma: {
    pushSubscription: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    setting: { findUnique: vi.fn(), create: vi.fn() },
  },
}));
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('web-push', () => ({
  default: {
    generateVAPIDKeys: vi.fn(() => ({ publicKey: 'pub', privateKey: 'priv' })),
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async () => undefined),
  },
}));
vi.mock('../config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/env')>();
  return {
    ...actual,
    env: {
      ...actual.env,
      VAPID_PUBLIC_KEY: 'pub',
      VAPID_PRIVATE_KEY: 'priv',
      VAPID_SUBJECT: 'mailto:admin@review.local',
    },
  };
});

import { lookup } from 'node:dns/promises';
import webpush from 'web-push';
import { prisma } from '../lib/prisma';
import { saveSubscription, sendToUser } from './PushService';

const PUBLIC_ADDRESS = [{ address: '93.184.216.34', family: 4 }];
const keys = { p256dh: 'p', auth: 'a' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lookup).mockResolvedValue(PUBLIC_ADDRESS as never);
});

describe('saveSubscription: anti-SSRF guard (E1)', () => {
  it('refuses a literal internal address without storing anything', async () => {
    await expect(saveSubscription(7, { endpoint: 'http://10.0.0.5/push', keys })).rejects.toMatchObject({
      statusCode: 400,
      code: 'PUSH_ENDPOINT_REFUSED',
    });
    expect(prisma.pushSubscription.upsert).not.toHaveBeenCalled();
  });

  it('refuses the cloud provider metadata service', async () => {
    await expect(
      saveSubscription(7, { endpoint: 'http://169.254.169.254/latest/meta-data/', keys }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses a scheme that is not http(s)', async () => {
    await expect(saveSubscription(7, { endpoint: 'redis://cache:6379', keys })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

    // The check applies to the resolved address: a perfectly public name can point to
    // the loopback interface.
  it('refuses a public name that resolves to an internal address', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    await expect(
      saveSubscription(7, { endpoint: 'https://push.exemple.com/abc', keys }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.pushSubscription.upsert).not.toHaveBeenCalled();
  });

  it('stores a subscription to a public push service', async () => {
    await saveSubscription(7, { endpoint: 'https://fcm.googleapis.com/fcm/send/xyz', keys });
    expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { endpoint: 'https://fcm.googleapis.com/fcm/send/xyz' } }),
    );
  });
});

describe('sendToUser: second check at send time', () => {
  it('does not send to a row that became internal, and serves the others', async () => {
        // Rows created before the guard are still in the database: the refusal must also
        // hold at send time.
    vi.mocked(prisma.pushSubscription.findMany).mockResolvedValue([
      { id: 1, endpoint: 'http://192.168.1.20:9001/', p256dh: 'p', auth: 'a' },
      { id: 2, endpoint: 'https://fcm.googleapis.com/fcm/send/xyz', p256dh: 'p', auth: 'a' },
    ] as never);

    sendToUser(7, { title: 't', body: 'b' });

    await vi.waitFor(() => expect(webpush.sendNotification).toHaveBeenCalledTimes(1));
    expect(vi.mocked(webpush.sendNotification).mock.calls[0]![0]).toMatchObject({
      endpoint: 'https://fcm.googleapis.com/fcm/send/xyz',
    });
  });
});
