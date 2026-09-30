// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

/**
 * La livraison d'un webhook part du worker, DANS le réseau applicatif. L'URL est saisie par
 * un admin de ReView — ce qui ne lui donne pas la main sur ce réseau. Ces tests figent le
 * refus (adresse interne, nom qui résout en privé, redirection) et le chemin nominal, y
 * compris la trace laissée sur le webhook.
 */
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('../lib/prisma', () => ({
  prisma: { webhook: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() } },
}));
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('../lib/crypto', () => ({ decryptSecret: vi.fn(() => 'shh') }));
vi.mock('./JobService', () => ({ enqueueWebhookDelivery: vi.fn() }));

import { lookup } from 'node:dns/promises';
import { prisma } from '../lib/prisma';
import { deliver } from './WebhookService';

const PUBLIC_ADDRESS = [{ address: '93.184.216.34', family: 4 }];

let fetchMock: Mock<typeof fetch>;

function hookAt(url: string) {
  vi.mocked(prisma.webhook.findUnique).mockResolvedValue({
    id: 1,
    url,
    active: true,
    secret: 'enc',
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lookup).mockResolvedValue(PUBLIC_ADDRESS as never);
  vi.mocked(prisma.webhook.update).mockResolvedValue({} as never);
  fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

describe('WebhookService.deliver — garde anti-SSRF', () => {
  it('refuse une adresse interne et laisse le motif sur le webhook', async () => {
    hookAt('http://169.254.169.254/latest/meta-data/');
    await expect(deliver(1, 'media.created', {})).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.webhook.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastStatus: null,
          lastError: expect.stringContaining('internal address') as unknown as string,
        }) as unknown,
      }),
    );
  });

  it('refuse un nom public qui résout vers une adresse interne', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    hookAt('https://hooks.exemple.com/x');
    await expect(deliver(1, 'media.created', {})).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ne rejoue jamais le POST signé derrière une redirection', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://10.0.0.5/' } }),
    );
    hookAt('https://hooks.exemple.com/x');
    await expect(deliver(1, 'media.created', {})).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('WebhookService.deliver — livraison', () => {
  it('poste la charge signée et enregistre le statut', async () => {
    hookAt('https://hooks.exemple.com/x');
    await deliver(1, 'media.created', { id: 3 });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe('POST');
    expect(headers['X-ReView-Event']).toBe('media.created');
    expect(headers['X-ReView-Signature']).toMatch(/^sha256=/);
    expect(JSON.parse(String(init.body))).toMatchObject({ event: 'media.created', data: { id: 3 } });
    expect(prisma.webhook.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastStatus: 200, lastError: null }) as unknown,
      }),
    );
  });

  it('remonte l’échec du destinataire pour déclencher la reprise BullMQ', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
    hookAt('https://hooks.exemple.com/x');
    await expect(deliver(1, 'media.created', {})).rejects.toThrow(/HTTP 500/);
    expect(prisma.webhook.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastStatus: 500, lastError: 'HTTP 500' }) as unknown,
      }),
    );
  });

  it('ne fait rien pour un webhook désactivé entre-temps', async () => {
    vi.mocked(prisma.webhook.findUnique).mockResolvedValue({
      id: 1,
      url: 'https://hooks.exemple.com/x',
      active: false,
      secret: 'enc',
    } as never);
    await deliver(1, 'media.created', {});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
