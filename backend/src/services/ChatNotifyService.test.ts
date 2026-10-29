// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

/**
 * `notifyChat` posted hard-coded French text, with a BARE `fetch`: no guard on the resolved address, no
 * refusal of redirects, although the URL comes from the administration.
 *
 * The test describes both requirements together, because they live in the same place: the sentence comes from
 * a catalogue (rendered in the studio's language) and the request goes through `safeFetch`. Hence the fake
 * DNS: the guard resolves the host before emitting.
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

/** The posted bodies, decoded: Discord expects `content`, Slack expects `text`. */
function postedBodies(): unknown[] {
  return fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
}

describe('ChatNotifyService.notifyChat (42.B #67)', () => {
  it('renders the sentence from the catalogue, in the studio language', async () => {
    studioFind.mockResolvedValue({ discordWebhookUrl: DISCORD } as never);
    settingFind.mockResolvedValue({ value: SLACK } as never);
    await notifyChat('chat.mediaPublished', { name: 'SH010_comp_v003.mov' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const expected = '🎬 New media published: SH010_comp_v003.mov';
    expect(postedBodies()).toContainEqual({ content: expected });
    expect(postedBodies()).toContainEqual({ text: expected });
  });

  it("follows the studio language, not the server's", async () => {
    studioFind.mockResolvedValue({ discordWebhookUrl: DISCORD } as never);
    settingFind.mockResolvedValue(null);
    vi.mocked(getDefaultLocale).mockResolvedValue('fr');
    await notifyChat('chat.mediaPublished', { name: 'SH010' });
    expect(postedBodies()).toContainEqual({ content: '🎬 Nouveau média publié : SH010' });
  });

  it('ignores invalid URLs (allow-list) and does not call fetch', async () => {
    studioFind.mockResolvedValue({ discordWebhookUrl: 'https://evil.com/hook' } as never);
    settingFind.mockResolvedValue({ value: 'http://hooks.slack.com/x' } as never);
    await notifyChat('chat.mediaPublished', { name: 'X' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a webhook whose name resolves to an internal address (SSRF)', async () => {
    // The allow-list only checks the starting URL: it is `safeFetch` that looks at the ADDRESS. A Discord
    // webhook whose name points to the application network must not let a request out.
    studioFind.mockResolvedValue({ discordWebhookUrl: DISCORD } as never);
    settingFind.mockResolvedValue(null);
    vi.mocked(lookup).mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as never);
    await notifyChat('chat.mediaPublished', { name: 'X' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not follow a redirect leaving the webhook', async () => {
    studioFind.mockResolvedValue({ discordWebhookUrl: DISCORD } as never);
    settingFind.mockResolvedValue(null);
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }),
    );
    await notifyChat('chat.mediaPublished', { name: 'X' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('gives up, and terminates, when faced with an upstream that never answers', async () => {
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
    expect(settled).toBe(false); // the timeout is not premature
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
    expect(settled).toBe(true);
  });

  it('never throws, even if a webhook fails', async () => {
    studioFind.mockResolvedValue({ discordWebhookUrl: DISCORD } as never);
    settingFind.mockResolvedValue(null);
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    await expect(notifyChat('chat.mediaPublished', { name: 'X' })).resolves.toBeUndefined();
  });
});
