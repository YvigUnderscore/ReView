// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

/**
 * `notifyChat` postait du texte français écrit en dur, avec un `fetch` NU : ni garde sur
 * l'adresse résolue, ni refus de redirection, alors que l'URL vient de l'administration.
 *
 * Le test décrit les deux exigences ensemble, parce qu'elles vivent au même endroit : la
 * phrase part d'un catalogue (rendue dans la langue du studio) et la requête part de
 * `safeFetch`. D'où le faux DNS : la garde résout l'hôte avant d'émettre.
 */

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('../lib/prisma', () => ({
  prisma: {
    studio: { findFirst: vi.fn() },
    setting: { findUnique: vi.fn() },
  },
}));
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('../lib/settings', () => ({ getDefaultLocale: vi.fn(() => Promise.resolve('en')) }));

import { lookup } from 'node:dns/promises';
import { notifyChat } from './ChatNotifyService';
import { prisma } from '../lib/prisma';
import { getDefaultLocale } from '../lib/settings';

const studioFind = vi.mocked(prisma.studio.findFirst);
const settingFind = vi.mocked(prisma.setting.findUnique);
const DISCORD = 'https://discord.com/api/webhooks/1/a';
const SLACK = 'https://hooks.slack.com/services/T/B/x';
const PUBLIC_ADDRESS = [{ address: '93.184.216.34', family: 4 }];

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lookup).mockResolvedValue(PUBLIC_ADDRESS as never);
  vi.mocked(getDefaultLocale).mockResolvedValue('en');
  fetchMock = vi.fn<typeof fetch>();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Les corps postés, décodés — Discord attend `content`, Slack `text`. */
function postedBodies(): unknown[] {
  return fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
}

describe('ChatNotifyService.notifyChat (42.B №67)', () => {
  it('rend la phrase depuis le catalogue, dans la langue du studio', async () => {
    studioFind.mockResolvedValue({ discordWebhookUrl: DISCORD } as never);
    settingFind.mockResolvedValue({ value: SLACK } as never);
    await notifyChat('chat.mediaPublished', { name: 'SH010_comp_v003.mov' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const expected = '🎬 New media published: SH010_comp_v003.mov';
    expect(postedBodies()).toContainEqual({ content: expected });
    expect(postedBodies()).toContainEqual({ text: expected });
  });

  it('suit la langue du studio et non celle du serveur', async () => {
    studioFind.mockResolvedValue({ discordWebhookUrl: DISCORD } as never);
    settingFind.mockResolvedValue(null);
    vi.mocked(getDefaultLocale).mockResolvedValue('fr');
    await notifyChat('chat.mediaPublished', { name: 'SH010' });
    expect(postedBodies()).toContainEqual({ content: '🎬 Nouveau média publié : SH010' });
  });

  it('ignore les URLs invalides (allow-list) et n’appelle pas fetch', async () => {
    studioFind.mockResolvedValue({ discordWebhookUrl: 'https://evil.com/hook' } as never);
    settingFind.mockResolvedValue({ value: 'http://hooks.slack.com/x' } as never);
    await notifyChat('chat.mediaPublished', { name: 'X' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuse un webhook dont le nom résout sur une adresse interne (SSRF)', async () => {
    // L'allow-list ne contrôle que l'URL de départ : c'est `safeFetch` qui regarde
    // l'ADRESSE. Un webhook Discord dont le nom pointe sur le réseau applicatif ne doit
    // pas faire sortir une requête.
    studioFind.mockResolvedValue({ discordWebhookUrl: DISCORD } as never);
    settingFind.mockResolvedValue(null);
    vi.mocked(lookup).mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as never);
    await notifyChat('chat.mediaPublished', { name: 'X' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ne suit pas une redirection sortie du webhook', async () => {
    studioFind.mockResolvedValue({ discordWebhookUrl: DISCORD } as never);
    settingFind.mockResolvedValue(null);
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }),
    );
    await notifyChat('chat.mediaPublished', { name: 'X' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('abandonne — et se termine — face à un amont qui ne répond jamais', async () => {
    studioFind.mockResolvedValue({ discordWebhookUrl: DISCORD } as never);
    settingFind.mockResolvedValue(null);
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, init) => {
      const signal = (init as RequestInit).signal!;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true });
      });
    });
    let settled = false;
    const pending = notifyChat('chat.mediaPublished', { name: 'X' }).then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(4000);
    expect(settled).toBe(false); // le délai n'est pas prématuré
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
    expect(settled).toBe(true);
  });

  it('ne jette jamais même si un webhook échoue', async () => {
    studioFind.mockResolvedValue({ discordWebhookUrl: DISCORD } as never);
    settingFind.mockResolvedValue(null);
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    await expect(notifyChat('chat.mediaPublished', { name: 'X' })).resolves.toBeUndefined();
  });
});
