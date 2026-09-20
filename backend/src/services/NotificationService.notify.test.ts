// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `notify()` — trois décisions, toutes prises à partir des préférences du destinataire :
 *
 * 1. le **type** servi au navigateur se déduit du genre (fin du `review_decision` en
 *    minuscules, que le front ne reconnaissait pas) ;
 * 2. le genre décide si la ligne s'écrit et si le push part ;
 * 3. le push se rend dans la langue du DESTINATAIRE. `resolveUserLocale` recevait le
 *    numéro de l'utilisateur au lieu de ses préférences : elle n'y trouvait aucun
 *    `locale` et retombait silencieusement sur le défaut du studio.
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

describe('notify — type dérivé du genre', () => {
  it('écrit REVIEW_DECISION en capitales pour le genre reviewDecision', async () => {
    await notify(decision);
    expect(prismaMock.notification.create).toHaveBeenCalledOnce();
    const { data } = prismaMock.notification.create.mock.calls[0]![0] as { data: { type: string } };
    expect(data.type).toBe('REVIEW_DECISION');
  });

  it('écrit le contenu anglais de repli, clé et paramètres compris', async () => {
    await notify(decision);
    const { data } = prismaMock.notification.create.mock.calls[0]![0] as {
      data: { content: string; messageKey: string };
    };
    expect(data.messageKey).toBe('notification.decision');
    expect(data.content).toBe('Decision « Approved » on version v003');
  });
});

describe('notify — réglages par type d’événement', () => {
  it('notifie tout par défaut (aucun réglage enregistré)', async () => {
    await notify(decision);
    expect(prismaMock.notification.create).toHaveBeenCalledOnce();
    expect(emitToUser).toHaveBeenCalledOnce();
    expect(sendToUser).toHaveBeenCalledOnce();
  });

  it('n’écrit RIEN quand le canal in-app est fermé pour ce genre', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ preferences: PREFS_ALL_OFF });
    await notify(decision);
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
    expect(emitToUser).not.toHaveBeenCalled();
    expect(sendToUser).not.toHaveBeenCalled();
  });

  it('écrit la ligne mais ne pousse pas quand seul le push est fermé', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      preferences: { notifications: { reviewDecision: { push: false } } },
    });
    await notify(decision);
    expect(prismaMock.notification.create).toHaveBeenCalledOnce();
    expect(sendToUser).not.toHaveBeenCalled();
  });

  it('ne coupe qu’un genre à la fois', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ preferences: PREFS_ALL_OFF });
    await notify({ ...decision, kind: 'mention', messageKey: 'notification.mentioned', params: undefined });
    expect(prismaMock.notification.create).toHaveBeenCalledOnce();
  });

  it('ne notifie pas un destinataire disparu', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await notify(decision);
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });
});

describe('notify — langue du push', () => {
  it('résout la langue depuis les PRÉFÉRENCES du destinataire, pas son identifiant', async () => {
    const preferences = { locale: 'ja' };
    prismaMock.user.findUnique.mockResolvedValue({ preferences });
    await notify(decision);
    expect(resolveUserLocale).toHaveBeenCalledWith(preferences);
  });

  it('rend le corps du push dans cette langue', async () => {
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
