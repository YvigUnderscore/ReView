// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `notify()` — three decisions, all taken from the recipient's preferences:
 *
 * 1. the **type** served to the browser is derived from the kind (end of `review_decision` in lowercase,
 * which the front end did not recognise);
 * 2. the kind decides whether the row is written and whether the push goes out;
 * 3. the push is rendered in the RECIPIENT's language. `resolveUserLocale` received the user's number instead
 * of their preferences: it found no
 *    `locale` there and silently fell back on the studio default.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    notification: { create: vi.fn() },
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('./SocketService', () => ({ emitToUser: vi.fn() }));
vi.mock('./PushService', () => ({ sendToUser: vi.fn() }));
vi.mock('../lib/settings', () => ({
  resolveUserLocale: vi.fn(() => Promise.resolve('en')),
  getDefaultLocale: vi.fn(() => Promise.resolve('en')),
}));

import { notify } from './NotificationService';
import { emitToUser } from './SocketService';
import { sendToUser } from './PushService';
import { resolveUserLocale } from '../lib/settings';

const PREFS_ALL_OFF = { notifications: { reviewDecision: { inApp: false, push: false } } };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findUnique.mockResolvedValue({ preferences: null });
  prismaMock.notification.create.mockImplementation(({ data }: { data: unknown }) =>
    Promise.resolve({ id: 1, ...(data as object) }),
  );
  vi.mocked(resolveUserLocale).mockResolvedValue('en');
});

const decision = {
  userId: 7,
  kind: 'reviewDecision' as const,
  messageKey: 'notification.decision' as const,
  params: { status: 'Approved', version: 'v003' },
  projectId: 3,
  referenceId: 42,
};

describe('notify: type derived from the kind', () => {
  it('writes REVIEW_DECISION in capitals for the reviewDecision kind', async () => {
    await notify(decision);
    expect(prismaMock.notification.create).toHaveBeenCalledOnce();
    const { data } = prismaMock.notification.create.mock.calls[0]![0] as { data: { type: string } };
    expect(data.type).toBe('REVIEW_DECISION');
  });

  it('writes the English fallback content, key and parameters included', async () => {
    await notify(decision);
    const { data } = prismaMock.notification.create.mock.calls[0]![0] as {
      data: { content: string; messageKey: string };
    };
    expect(data.messageKey).toBe('notification.decision');
    expect(data.content).toBe('Decision « Approved » on version v003');
  });
});

describe('notify: settings per event type', () => {
  it('notifies everything by default (no setting saved)', async () => {
    await notify(decision);
    expect(prismaMock.notification.create).toHaveBeenCalledOnce();
    expect(emitToUser).toHaveBeenCalledOnce();
    expect(sendToUser).toHaveBeenCalledOnce();
  });

  it('writes NOTHING when the in-app channel is closed for this kind', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ preferences: PREFS_ALL_OFF });
    await notify(decision);
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
    expect(emitToUser).not.toHaveBeenCalled();
    expect(sendToUser).not.toHaveBeenCalled();
  });

  it('writes the row but does not push when only the push is closed', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      preferences: { notifications: { reviewDecision: { push: false } } },
    });
    await notify(decision);
    expect(prismaMock.notification.create).toHaveBeenCalledOnce();
    expect(sendToUser).not.toHaveBeenCalled();
  });

  it('cuts only one kind at a time', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ preferences: PREFS_ALL_OFF });
    await notify({ ...decision, kind: 'mention', messageKey: 'notification.mentioned', params: undefined });
    expect(prismaMock.notification.create).toHaveBeenCalledOnce();
  });

  it('does not notify a vanished recipient', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await notify(decision);
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });
});

describe('notify: push language', () => {
  it("resolves the language from the recipient's PREFERENCES, not from their identifier", async () => {
    const preferences = { locale: 'ja' };
    prismaMock.user.findUnique.mockResolvedValue({ preferences });
    await notify(decision);
    expect(resolveUserLocale).toHaveBeenCalledWith(preferences);
  });

  it('renders the push body in that language', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ preferences: { locale: 'fr' } });
    vi.mocked(resolveUserLocale).mockResolvedValue('fr');
    await notify(decision);
    expect(sendToUser).toHaveBeenCalledWith(7, {
      title: 'ReView',
      body: 'Décision « Approved » sur la version v003',
      url: '/projects/3',
    });
  });
});
