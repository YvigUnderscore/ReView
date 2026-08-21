// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * E1 de l'audit du 2026-08-21 : `POST /api/push/subscribe` acceptait n'importe quelle URL,
 * et `web-push` allait ensuite y poster depuis le réseau applicatif — où MinIO, Redis,
 * Postgres et 169.254.169.254 répondent sans authentification réseau. La primitive était
 * ouverte à toute session, CLIENT compris. Ces tests fixent le refus, à l'enregistrement
 * comme à l'envoi.
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

describe('saveSubscription — garde anti-SSRF (E1)', () => {
  it('refuse une adresse interne littérale sans rien enregistrer', async () => {
    await expect(saveSubscription(7, { endpoint: 'http://10.0.0.5/push', keys })).rejects.toMatchObject({
      statusCode: 400,
      code: 'PUSH_ENDPOINT_REFUSED',
    });
    expect(prisma.pushSubscription.upsert).not.toHaveBeenCalled();
  });

  it('refuse le service de métadonnées du fournisseur cloud', async () => {
    await expect(
      saveSubscription(7, { endpoint: 'http://169.254.169.254/latest/meta-data/', keys }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuse un schéma qui n’est pas http(s)', async () => {
    await expect(saveSubscription(7, { endpoint: 'redis://cache:6379', keys })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  // Le contrôle porte sur l'adresse résolue : un nom parfaitement public peut pointer
  // vers la boucle locale.
  it('refuse un nom public qui résout vers une adresse interne', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    await expect(
      saveSubscription(7, { endpoint: 'https://push.exemple.com/abc', keys }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.pushSubscription.upsert).not.toHaveBeenCalled();
  });

  it('enregistre un abonnement vers un service de push public', async () => {
    await saveSubscription(7, { endpoint: 'https://fcm.googleapis.com/fcm/send/xyz', keys });
    expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { endpoint: 'https://fcm.googleapis.com/fcm/send/xyz' } }),
    );
  });
});

describe('sendToUser — second contrôle à l’envoi', () => {
  it('n’émet pas vers une ligne devenue interne, et sert les autres', async () => {
    // Les lignes créées avant la garde sont toujours en base : le refus doit valoir
    // aussi au moment de l'envoi.
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
