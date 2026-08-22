// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

/**
 * Portée et trace des webhooks.
 *
 * Deux promesses qu'on ne pouvait pas tenir jusqu'ici : « ce webhook ne voit que ce
 * projet » et « on sait ce qui a été livré ». La première est une question de
 * confidentialité (le Slack d'un client recevait les publications de tous les films du
 * studio) ; la seconde décide de ce qu'on peut rattraper après cinq échecs.
 */
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('../lib/prisma', () => ({
  prisma: {
    webhook: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    webhookDelivery: { create: vi.fn(), update: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('../lib/crypto', () => ({ decryptSecret: vi.fn(() => 'shh') }));
vi.mock('./JobService', () => ({ enqueueWebhookDelivery: vi.fn() }));

import { lookup } from 'node:dns/promises';
import { prisma } from '../lib/prisma';
import { enqueueWebhookDelivery } from './JobService';
import {
  deliver,
  emitWebhookEvent,
  FAILURE_STREAK_LIMIT,
  queueDelivery,
  replayDelivery,
  RESPONSE_BODY_MAX,
  subscriberFilter,
  unpackDelivery,
} from './WebhookService';

const PUBLIC_ADDRESS = [{ address: '93.184.216.34', family: 4 }];
let fetchMock: Mock<typeof fetch>;

const activeHook = () =>
  vi.mocked(prisma.webhook.findUnique).mockResolvedValue({
    id: 1,
    url: 'https://hooks.exemple.com/x',
    active: true,
    secret: 'enc',
  } as never);

/** Laisse se dérouler la promesse non attendue de `emitWebhookEvent`. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lookup).mockResolvedValue(PUBLIC_ADDRESS as never);
  vi.mocked(prisma.webhook.update).mockResolvedValue({ failureStreak: 0 } as never);
  vi.mocked(prisma.webhookDelivery.create).mockResolvedValue({ id: 77 } as never);
  vi.mocked(prisma.webhookDelivery.update).mockResolvedValue({ attempts: 1 } as never);
  vi.mocked(prisma.webhook.findMany).mockResolvedValue([] as never);
  fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

describe('portée projet', () => {
  it('un événement de projet va aux webhooks du studio ET à ceux de ce projet', () => {
    expect(subscriberFilter('version.published', 12)).toEqual({
      active: true,
      events: { has: 'version.published' },
      OR: [{ projectId: null }, { projectId: 12 }],
    });
  });

  it('un événement sans projet ne va qu’aux webhooks du studio', () => {
    expect(subscriberFilter('version.published', null)).toEqual({
      active: true,
      events: { has: 'version.published' },
      projectId: null,
    });
  });

  it('émettre n’interroge que les abonnés de la portée', async () => {
    emitWebhookEvent('version.published', { versionId: 3 }, { projectId: 12, apiEventId: 5 });
    await settle();
    expect(prisma.webhook.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: subscriberFilter('version.published', 12) }),
    );
  });

  it('ouvre une ligne de journal par abonné avant d’enfiler', async () => {
    vi.mocked(prisma.webhook.findMany).mockResolvedValue([{ id: 1 }, { id: 2 }] as never);
    emitWebhookEvent('version.published', { versionId: 3 }, { projectId: 12, apiEventId: 5 });
    await settle();
    expect(prisma.webhookDelivery.create).toHaveBeenCalledTimes(2);
    expect(enqueueWebhookDelivery).toHaveBeenCalledTimes(2);
  });
});

describe('journal des livraisons', () => {
  it('enfile la charge accompagnée de l’identifiant de livraison', async () => {
    const id = await queueDelivery(1, 'version.published', { versionId: 3 }, { apiEventId: 5 });
    expect(id).toBe(77);
    expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ webhookId: 1, event: 'version.published', apiEventId: 5 }) as unknown,
      }),
    );
    expect(enqueueWebhookDelivery).toHaveBeenCalledWith({
      webhookId: 1,
      event: 'version.published',
      payload: { versionId: 3, _reviewDeliveryId: 77 },
    });
  });

  it('retire l’enveloppe de la charge envoyée au destinataire', () => {
    expect(unpackDelivery({ a: 1, _reviewDeliveryId: 9 })).toEqual({ deliveryId: 9, data: { a: 1 } });
    expect(unpackDelivery({ a: 1 })).toEqual({ deliveryId: null, data: { a: 1 } });
  });

  it('signe un corps qui porte l’identifiant, et l’annonce en en-tête', async () => {
    activeHook();
    await deliver(1, 'version.published', { versionId: 3, _reviewDeliveryId: 77 });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['X-ReView-Delivery']).toBe('77');
    expect(JSON.parse(String(init.body))).toEqual({
      id: 77,
      event: 'version.published',
      timestamp: expect.any(Number),
      data: { versionId: 3 },
    });
  });

  it('marque la livraison remise et efface la série d’échecs', async () => {
    activeHook();
    await deliver(1, 'version.published', { versionId: 3, _reviewDeliveryId: 77 });
    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 77 },
        data: expect.objectContaining({ status: 'DELIVERED', responseStatus: 200 }) as unknown,
      }),
    );
    expect(prisma.webhook.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ failureStreak: 0 }) as unknown }),
    );
  });

  it('tronque le corps de réponse conservé', async () => {
    fetchMock.mockResolvedValueOnce(new Response('x'.repeat(5000), { status: 500 }));
    activeHook();
    await expect(deliver(1, 'x', { _reviewDeliveryId: 77 })).rejects.toThrow(/HTTP 500/);
    const call = vi.mocked(prisma.webhookDelivery.update).mock.calls[0]![0] as {
      data: { responseBody: string; status: string };
    };
    expect(call.data.status).toBe('FAILED');
    expect(call.data.responseBody).toHaveLength(RESPONSE_BODY_MAX);
  });
});

describe('webhook mort', () => {
  it('ne compte une perte qu’une fois les reprises épuisées', async () => {
    vi.mocked(prisma.webhookDelivery.update).mockResolvedValue({ attempts: 2 } as never);
    fetchMock.mockResolvedValue(new Response('', { status: 502 }));
    activeHook();
    await expect(deliver(1, 'x', { _reviewDeliveryId: 77 })).rejects.toThrow();
    const data = (vi.mocked(prisma.webhook.update).mock.calls[0]![0] as { data: Record<string, unknown> })
      .data;
    expect(data.failureStreak).toBeUndefined();
  });

  it('désactive le webhook après assez de livraisons définitivement perdues', async () => {
    vi.mocked(prisma.webhookDelivery.update).mockResolvedValue({ attempts: 5 } as never);
    vi.mocked(prisma.webhook.update).mockResolvedValue({ failureStreak: FAILURE_STREAK_LIMIT } as never);
    fetchMock.mockResolvedValue(new Response('', { status: 502 }));
    activeHook();
    await expect(deliver(1, 'x', { _reviewDeliveryId: 77 })).rejects.toThrow();
    expect(prisma.webhook.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { active: false } });
  });
});

describe('rejeu', () => {
  it('crée une nouvelle ligne qui référence la perdue', async () => {
    vi.mocked(prisma.webhookDelivery.findFirst).mockResolvedValue({
      id: 40,
      event: 'version.published',
      payload: { versionId: 3 },
      apiEventId: 5,
    } as never);
    vi.mocked(prisma.webhookDelivery.create).mockResolvedValue({ id: 78 } as never);
    expect(await replayDelivery(1, 40)).toBe(78);
    expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          replayOfId: 40,
          apiEventId: 5,
          event: 'version.published',
        }) as unknown,
      }),
    );
  });

  it('rend null pour une livraison qui n’appartient pas à ce webhook', async () => {
    vi.mocked(prisma.webhookDelivery.findFirst).mockResolvedValue(null);
    expect(await replayDelivery(1, 40)).toBeNull();
    expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
  });
});
