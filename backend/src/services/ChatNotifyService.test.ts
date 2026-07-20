import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    studio: { findFirst: vi.fn() },
    setting: { findUnique: vi.fn() },
  },
}));
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn() } }));

import { notifyChat } from './ChatNotifyService';
import { prisma } from '../lib/prisma';

const studioFind = vi.mocked(prisma.studio.findFirst);
const settingFind = vi.mocked(prisma.setting.findUnique);
const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response);

describe('ChatNotifyService.notifyChat (42.B №67)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('poste sur Discord (content) et Slack (text) quand configurés et valides', async () => {
    studioFind.mockResolvedValue({ discordWebhookUrl: 'https://discord.com/api/webhooks/1/a' } as never);
    settingFind.mockResolvedValue({ value: 'https://hooks.slack.com/services/T/B/x' } as never);
    await notifyChat('Hello');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(bodies).toContainEqual({ content: 'Hello' });
    expect(bodies).toContainEqual({ text: 'Hello' });
  });

  it('ignore les URLs invalides (anti-SSRF) et n’appelle pas fetch', async () => {
    studioFind.mockResolvedValue({ discordWebhookUrl: 'https://evil.com/hook' } as never);
    settingFind.mockResolvedValue({ value: 'http://hooks.slack.com/x' } as never);
    await notifyChat('Nope');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ne jette jamais même si un webhook échoue', async () => {
    studioFind.mockResolvedValue({ discordWebhookUrl: 'https://discord.com/api/webhooks/1/a' } as never);
    settingFind.mockResolvedValue(null as never);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    await expect(notifyChat('X')).resolves.toBeUndefined();
  });
});
