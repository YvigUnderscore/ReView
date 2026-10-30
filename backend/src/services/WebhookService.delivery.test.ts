// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

/**
 * Scope and trace of webhooks.
 *
 * Two promises that could not be kept until now: "this webhook only sees this project" and "we know what was delivered".
 * The first is a confidentiality question (a client's Slack received the publications of every film in the studio); the
 * second decides what can be recovered after five failures.
 */
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('../lib/prisma', () => ({
  prisma: {
    webhook: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    webhookDelivery: { create: vi.fn(), update: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../lib/crypto', () => ({ decryptSecret: vi.fn(() => 'shh') }));
vi.mock('../lib/queues', () => ({ enqueueWebhookDelivery: vi.fn() }));

import { lookup } from 'node:dns/promises';
import { prisma } from '../lib/prisma';
import { decryptSecret } from '../lib/crypto';
import { enqueueWebhookDelivery } from '../lib/queues';
import {
  deliver,
  emitWebhookEvent,
  FAILURE_STREAK_LIMIT,
  queueDelivery,
  replayDelivery,
  RESPONSE_BODY_MAX,
  SECRET_UNREADABLE_ERROR,
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

/** Lets the unawaited promise of `emitWebhookEvent` run to completion. */
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

describe('project scope', () => {
  it('a project event goes to the studio webhooks AND to those of that project', () => {
    expect(subscriberFilter('version.published', 12)).toEqual({
      active: true,
      events: { has: 'version.published' },
      OR: [{ projectId: null }, { projectId: 12 }],
    });
  });

  it('an event without a project goes only to the studio webhooks', () => {
    expect(subscriberFilter('version.published', null)).toEqual({
      active: true,
      events: { has: 'version.published' },
      projectId: null,
    });
  });

  it('emitting only queries the subscribers in scope', async () => {
    emitWebhookEvent('version.published', { versionId: 3 }, { projectId: 12, apiEventId: 5 });
    await settle();
    expect(prisma.webhook.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: subscriberFilter('version.published', 12) }),
    );
  });

  it('opens one journal line per subscriber before enqueuing', async () => {
    vi.mocked(prisma.webhook.findMany).mockResolvedValue([{ id: 1 }, { id: 2 }] as never);
    emitWebhookEvent('version.published', { versionId: 3 }, { projectId: 12, apiEventId: 5 });
    await settle();
    expect(prisma.webhookDelivery.create).toHaveBeenCalledTimes(2);
    expect(enqueueWebhookDelivery).toHaveBeenCalledTimes(2);
  });
});

describe('delivery log', () => {
  it('enqueues the payload together with the delivery identifier', async () => {
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

  it('strips the envelope from the payload sent to the recipient', () => {
    expect(unpackDelivery({ a: 1, _reviewDeliveryId: 9 })).toEqual({ deliveryId: 9, data: { a: 1 } });
    expect(unpackDelivery({ a: 1 })).toEqual({ deliveryId: null, data: { a: 1 } });
  });

  it('signs a body carrying the identifier, and announces it in a header', async () => {
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

  it('marks the delivery as delivered and clears the failure streak', async () => {
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

  it('truncates the stored response body', async () => {
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
  it('counts a loss only once the retries are exhausted', async () => {
    vi.mocked(prisma.webhookDelivery.update).mockResolvedValue({ attempts: 2 } as never);
    fetchMock.mockResolvedValue(new Response('', { status: 502 }));
    activeHook();
    await expect(deliver(1, 'x', { _reviewDeliveryId: 77 })).rejects.toThrow();
    const data = (vi.mocked(prisma.webhook.update).mock.calls[0]![0] as { data: Record<string, unknown> })
      .data;
    expect(data.failureStreak).toBeUndefined();
  });

  it('deactivates the webhook after enough permanently lost deliveries', async () => {
    vi.mocked(prisma.webhookDelivery.update).mockResolvedValue({ attempts: 5 } as never);
    vi.mocked(prisma.webhook.update).mockResolvedValue({ failureStreak: FAILURE_STREAK_LIMIT } as never);
    fetchMock.mockResolvedValue(new Response('', { status: 502 }));
    activeHook();
    await expect(deliver(1, 'x', { _reviewDeliveryId: 77 })).rejects.toThrow();
    expect(prisma.webhook.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { active: false } });
  });
});

describe('secret illisible', () => {
  it('emits nothing rather than sign with an empty key', async () => {
    // decryptSecret returns null as soon as the encryption key has changed. The empty-string fallback then
    // signed with an EMPTY HMAC key: the delivery left with a well-formed X-ReView-Signature header, yet one that anyone
    // knowing the URL could recompute, enough to forge a ReView event and trigger the studio's downstream pipeline.
    vi.mocked(decryptSecret).mockReturnValueOnce(null);
    activeHook();
    await deliver(1, 'version.published', { versionId: 3, _reviewDeliveryId: 77 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves the reason readable in the webhook journal', async () => {
    vi.mocked(decryptSecret).mockReturnValueOnce(null);
    activeHook();
    await deliver(1, 'version.published', { versionId: 3, _reviewDeliveryId: 77 });
    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 77 },
        data: expect.objectContaining({
          status: 'FAILED',
          error: SECRET_UNREADABLE_ERROR,
        }) as unknown,
      }),
    );
    expect(prisma.webhook.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastError: SECRET_UNREADABLE_ERROR }) as unknown,
      }),
    );
  });

  it('does not retry: a retry would not repair a changed key', async () => {
    vi.mocked(decryptSecret).mockReturnValueOnce(null);
    activeHook();
    await expect(deliver(1, 'version.published', { _reviewDeliveryId: 77 })).resolves.toBeUndefined();
  });
});

describe('rejeu', () => {
  it('creates a new line that references the lost one', async () => {
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

  it('returns null for a delivery that does not belong to this webhook', async () => {
    vi.mocked(prisma.webhookDelivery.findFirst).mockResolvedValue(null);
    expect(await replayDelivery(1, 40)).toBeNull();
    expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
  });
});
