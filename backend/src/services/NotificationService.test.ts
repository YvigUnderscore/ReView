// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

/**
 * A2-07 — `sendDiscord` appelait `fetch` sans aucun délai d'attente. Un relais qui accepte
 * la connexion puis se tait retenait la promesse *indéfiniment* : un socket et le contexte
 * du message immobilisés par notification, sans que le `catch` soit jamais atteint.
 *
 * Le test décrit exactement cela : horloge factice, amont muet, et l'exigence que l'appel
 * **se termine**. Avec l'ancien code il ne se terminait pas.
 */

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

const { prismaMock, loggerMock } = vi.hoisted(() => ({
  prismaMock: { studio: { findFirst: vi.fn() }, notification: { create: vi.fn() } },
  loggerMock: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('../lib/logger', () => ({ logger: loggerMock }));
vi.mock('./SocketService', () => ({ emitToUser: vi.fn() }));
vi.mock('./PushService', () => ({ sendToUser: vi.fn() }));
vi.mock('../lib/settings', () => ({
  resolveUserLocale: vi.fn(() => Promise.resolve('en')),
  getDefaultLocale: vi.fn(() => Promise.resolve('en')),
}));

import { lookup } from 'node:dns/promises';
import { sendDiscord } from './NotificationService';

const WEBHOOK = 'https://discord.com/api/webhooks/1/JETON';
const PUBLIC_ADDRESS = [{ address: '93.184.216.34', family: 4 }];

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lookup).mockResolvedValue(PUBLIC_ADDRESS as never);
  prismaMock.studio.findFirst.mockResolvedValue({ discordWebhookUrl: WEBHOOK });
  fetchMock = vi.fn<typeof fetch>();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('NotificationService.sendDiscord — délai d’attente (A2-07)', () => {
  it('poste le message quand le webhook répond', async () => {
    await sendDiscord('chat.newComment', { project: 4 });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(WEBHOOK);
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).body).toBe(
      JSON.stringify({ content: '💬 New comment on a media (project #4)' }),
    );
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it('abandonne — et se termine — face à un amont qui ne répond jamais', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, init) => {
      const signal = (init as RequestInit).signal!;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true });
      });
    });
    let settled = false;
    const pending = sendDiscord('chat.newComment', { project: 4 }).then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(4000);
    expect(settled).toBe(false); // le délai n'est pas prématuré
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
    expect(settled).toBe(true);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.objectContaining({ code: 'OUTBOUND_TIMEOUT' }) }),
      expect.any(String),
    );
  });

  it('ne suit pas une redirection sortie du webhook', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }),
    );
    await sendDiscord('chat.newComment', { project: 4 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.objectContaining({ code: 'OUTBOUND_BLOCKED' }) }),
      expect.any(String),
    );
  });

  it('journalise un webhook refusé au lieu de rester muet', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }));
    await sendDiscord('chat.newComment', { project: 4 });
    expect(loggerMock.warn).toHaveBeenCalledWith({ status: 404 }, expect.any(String));
  });

  it("n'émet rien quand aucun webhook valide n'est configuré", async () => {
    prismaMock.studio.findFirst.mockResolvedValue({ discordWebhookUrl: 'https://evil.test/hook' });
    await sendDiscord('chat.newComment', { project: 4 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
