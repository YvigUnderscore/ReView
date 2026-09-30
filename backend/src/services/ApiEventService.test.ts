// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le journal v1 et les webhooks partent du même point. Ce qui se joue ici :
 *  - la ligne de journal est écrite AVANT l'émission, pour que son identifiant accompagne
 *    la livraison (c'est lui qui permet à un consommateur de recouper les deux) ;
 *  - un incident du journal ne doit pas retenir la livraison — l'abonné reçoit quand même ;
 *  - un même fait publié par deux couches (service puis route v1 héritée) ne fait qu'un.
 */
vi.mock('../lib/prisma', () => ({ prisma: { apiEvent: { create: vi.fn() } } }));
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('./WebhookService', () => ({ emitWebhookEvent: vi.fn() }));

import { prisma } from '../lib/prisma';
import { emitWebhookEvent } from './WebhookService';
import { publish } from './ApiEventService';

/** `publish` ne s'attend pas : on laisse la chaîne de promesses se dérouler. */
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

describe('ApiEventService.publish — journal puis livraison', () => {
  it('écrit la ligne de journal et passe son identifiant à l’émission', async () => {
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

  it('livre quand même si la journalisation échoue', async () => {
    vi.mocked(prisma.apiEvent.create).mockRejectedValueOnce(new Error('base injoignable'));
    publish('comment.created', { projectId: 7, payload: {} });
    await settle();
    expect(emitWebhookEvent).toHaveBeenCalledWith(
      'comment.created',
      { projectId: 7 },
      { projectId: 7, apiEventId: null },
    );
  });

  it('ne lève jamais, même si la base est absente', async () => {
    vi.mocked(prisma.apiEvent.create).mockImplementation(() => {
      throw new Error('client non initialisé');
    });
    expect(() => publish('comment.created', { payload: {} })).not.toThrow();
    await settle();
  });
});

describe('ApiEventService.publish — coalescence du même fait', () => {
  it('ne publie qu’une fois une version publiée deux fois de suite', async () => {
    const input = { projectId: 1, entityType: 'version', entityId: 9, payload: {} };
    publish('version.published', input);
    publish('version.published', input);
    await settle();
    expect(prisma.apiEvent.create).toHaveBeenCalledTimes(1);
    expect(emitWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it('n’étouffe pas deux versions différentes', async () => {
    publish('version.published', { projectId: 1, entityType: 'version', entityId: 10, payload: {} });
    publish('version.published', { projectId: 1, entityType: 'version', entityId: 11, payload: {} });
    await settle();
    expect(emitWebhookEvent).toHaveBeenCalledTimes(2);
  });

  it('ne coalesce pas les autres événements : deux changements rapprochés sont deux faits', async () => {
    const input = { projectId: 1, entityType: 'task', entityId: 5, payload: {} };
    publish('task.status_changed', input);
    publish('task.status_changed', input);
    await settle();
    expect(emitWebhookEvent).toHaveBeenCalledTimes(2);
  });

  it('republie le même fait une fois la fenêtre écoulée', async () => {
    const input = { projectId: 1, entityType: 'version', entityId: 12, payload: {} };
    publish('version.published', input);
    vi.setSystemTime(Date.now() + 6_000);
    publish('version.published', input);
    await settle();
    vi.useRealTimers();
    expect(emitWebhookEvent).toHaveBeenCalledTimes(2);
  });
});
