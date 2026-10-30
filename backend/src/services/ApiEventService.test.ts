// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The v1 journal and the webhooks start from the same point. What is at stake here:
 *  - the journal row is written BEFORE emission, so that its identifier travels with the delivery
 *    (it is what lets a consumer match the two);
 *  - a journal failure must not hold back the delivery: the subscriber still receives it;
 *  - a single fact published by two layers (service, then the legacy v1 route) counts once.
 */
vi.mock('../lib/prisma', () => ({ prisma: { apiEvent: { create: vi.fn() } } }));
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('./WebhookService', () => ({ emitWebhookEvent: vi.fn() }));

import { prisma } from '../lib/prisma';
import { emitWebhookEvent } from './WebhookService';
import { publish } from './ApiEventService';

/** `publish` is not awaited: the promise chain is left to run its course. */
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

let nextId = 1;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.apiEvent.create).mockImplementation(() => Promise.resolve({ id: nextId++ }) as never);
});

describe('ApiEventService.publish: journal, then delivery', () => {
  it('writes the journal row and passes its identifier on emission', async () => {
    publish('comment.created', {
      projectId: 7,
      entityType: 'comment',
      entityId: 42,
      actorId: 3,
      payload: { commentId: 42 },
    });
    await settle();

    expect(prisma.apiEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event: 'comment.created',
          projectId: 7,
          entityType: 'comment',
          entityId: 42,
          actorId: 3,
        }) as unknown,
      }),
    );
    expect(emitWebhookEvent).toHaveBeenCalledWith(
      'comment.created',
      { commentId: 42, projectId: 7 },
      { projectId: 7, apiEventId: 1 },
    );
  });

  it('still delivers if journaling fails', async () => {
    vi.mocked(prisma.apiEvent.create).mockRejectedValueOnce(new Error('base injoignable'));
    publish('comment.created', { projectId: 7, payload: {} });
    await settle();
    expect(emitWebhookEvent).toHaveBeenCalledWith(
      'comment.created',
      { projectId: 7 },
      { projectId: 7, apiEventId: null },
    );
  });

  it('never throws, even when the database is absent', async () => {
    vi.mocked(prisma.apiEvent.create).mockImplementation(() => {
      throw new Error('client non initialisé');
    });
    expect(() => publish('comment.created', { payload: {} })).not.toThrow();
    await settle();
  });
});

describe('ApiEventService.publish: coalescing of the same fact', () => {
  it('publishes only once a version published twice in a row', async () => {
    const input = { projectId: 1, entityType: 'version', entityId: 9, payload: {} };
    publish('version.published', input);
    publish('version.published', input);
    await settle();
    expect(prisma.apiEvent.create).toHaveBeenCalledTimes(1);
    expect(emitWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it('does not swallow two different versions', async () => {
    publish('version.published', { projectId: 1, entityType: 'version', entityId: 10, payload: {} });
    publish('version.published', { projectId: 1, entityType: 'version', entityId: 11, payload: {} });
    await settle();
    expect(emitWebhookEvent).toHaveBeenCalledTimes(2);
  });

  it('does not coalesce other events: two close changes are two facts', async () => {
    const input = { projectId: 1, entityType: 'task', entityId: 5, payload: {} };
    publish('task.status_changed', input);
    publish('task.status_changed', input);
    await settle();
    expect(emitWebhookEvent).toHaveBeenCalledTimes(2);
  });

  it('republishes the same fact once the window has elapsed', async () => {
    const input = { projectId: 1, entityType: 'version', entityId: 12, payload: {} };
    publish('version.published', input);
    vi.setSystemTime(Date.now() + 6_000);
    publish('version.published', input);
    await settle();
    vi.useRealTimers();
    expect(emitWebhookEvent).toHaveBeenCalledTimes(2);
  });
});
