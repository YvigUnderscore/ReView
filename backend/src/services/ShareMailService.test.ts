// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` est hissé : la fabrique ne peut pas capturer une variable du module. On la
// crée donc DANS la fabrique, puis on la récupère par l'import.
vi.mock('../config/env', () => ({ env: { APP_URL: 'https://review.example' } }));
vi.mock('../lib/prisma', () => ({
  prisma: { shareLink: { findUnique: vi.fn() }, user: { findUnique: vi.fn() } },
}));
vi.mock('../lib/mailer', () => ({
  isMailerConfigured: vi.fn().mockResolvedValue(true),
  sendMail: vi.fn().mockResolvedValue(true),
}));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('../lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { ShareScope } from '@prisma/client';
import { renderShareMailHtml, scopeLine, sendShareMail, shareUrl } from './ShareMailService';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { isMailerConfigured, sendMail } from '../lib/mailer';

const envMock = env as unknown as { APP_URL: string | undefined };

/**
 * Le lien n'était que copié dans le presse-papier : le client recevait une URL nue, sans
 * savoir ce qu'elle ouvrait ni quand elle périmait. Ces tests portent sur ce que le message
 * dit et sur ce qu'il ne fait pas — révéler les autres destinataires.
 */
const ctx = {
  projectName: 'Nuit blanche',
  senderName: 'Alice',
  scope: ShareScope.PROJECT,
  scopeTarget: null,
  expiresAt: null as Date | null,
  maxViews: null as number | null,
  hasPassword: false,
  note: null as string | null,
  url: 'https://review.example/client/abc',
};

beforeEach(() => {
  vi.clearAllMocks();
  envMock.APP_URL = 'https://review.example';
  vi.mocked(isMailerConfigured).mockResolvedValue(true);
  vi.mocked(sendMail).mockResolvedValue(true);
});

describe('renderShareMailHtml', () => {
  // Deux `href` (le bouton et le repli) plus l'URL en toutes lettres : beaucoup de clients
  // mail bloquent les boutons, et certains destinataires recopient l'adresse à la main.
  it('porte le lien dans le bouton et en clair dans le repli', () => {
    const html = renderShareMailHtml('en', ctx);
    expect(html.split(`href="${ctx.url}"`).length - 1).toBe(2);
    expect(html).toContain(`>${ctx.url}</a>`);
  });

  // La note vient d'un champ libre du superviseur : elle est réinjectée dans du HTML.
  it('échappe la note au lieu de la rendre', () => {
    const html = renderShareMailHtml('en', { ...ctx, note: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('omet le bloc de note quand il n’y en a pas', () => {
    expect(renderShareMailHtml('en', ctx)).not.toContain('padding-left:12px');
  });

  // Deux clés distinctes : le message dit toujours ce qu'il en est de la péremption,
  // et ne dit jamais la même chose dans les deux cas.
  it('distingue un lien qui expire d’un lien qui n’expire pas', () => {
    const withDate = renderShareMailHtml('en', { ...ctx, expiresAt: new Date('2026-09-01T00:00:00Z') });
    expect(withDate).not.toBe(renderShareMailHtml('en', ctx));
  });

  it('mentionne la limite de vues et le mot de passe seulement s’ils existent', () => {
    const plain = renderShareMailHtml('en', ctx);
    expect(renderShareMailHtml('en', { ...ctx, maxViews: 3 })).not.toBe(plain);
    expect(renderShareMailHtml('en', { ...ctx, hasPassword: true })).not.toBe(plain);
  });
});

describe('scopeLine', () => {
  it('dit une chose différente pour chaque portée', () => {
    const lines = [ShareScope.PROJECT, ShareScope.PLAYLIST, ShareScope.VERSION, ShareScope.MEDIA].map((s) =>
      scopeLine('en', { scope: s, scopeTarget: 'Reel 1' }),
    );
    expect(new Set(lines).size).toBe(4);
  });
});

describe('shareUrl', () => {
  it('compose l’URL publique depuis APP_URL', () => {
    expect(shareUrl('abc')).toBe('https://review.example/client/abc');
  });
});

const link = {
  id: 4,
  token: 'abc',
  projectId: 7,
  revoked: false,
  expiresAt: null,
  maxViews: null,
  passwordHash: null,
  scope: ShareScope.PROJECT,
  project: { name: 'Nuit blanche' },
  playlist: null,
  version: null,
};

describe('sendShareMail', () => {
  beforeEach(() => {
    vi.mocked(prisma.shareLink.findUnique).mockResolvedValue(link as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 2, email: 'a@b.c', name: 'Alice' } as never);
  });

  // Une liste en clair dans `To:` révèle à chaque client l'adresse des autres.
  it('envoie un message par destinataire', async () => {
    await expect(sendShareMail(2, 4, ['x@studio.fr', 'y@client.com'], null)).resolves.toEqual({ sent: 2 });
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendMail).mock.calls.map((c) => c[0])).toEqual(['x@studio.fr', 'y@client.com']);
  });

  it('refuse tôt sans URL publique', async () => {
    envMock.APP_URL = undefined;
    await expect(sendShareMail(2, 4, ['x@studio.fr'], null)).rejects.toMatchObject({
      code: 'APP_URL_MISSING',
    });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('refuse tôt sans relais SMTP', async () => {
    vi.mocked(isMailerConfigured).mockResolvedValue(false);
    await expect(sendShareMail(2, 4, ['x@studio.fr'], null)).rejects.toMatchObject({
      code: 'SMTP_NOT_CONFIGURED',
    });
  });

  it('refuse d’envoyer un lien révoqué', async () => {
    vi.mocked(prisma.shareLink.findUnique).mockResolvedValue({ ...link, revoked: true } as never);
    await expect(sendShareMail(2, 4, ['x@studio.fr'], null)).rejects.toMatchObject({
      code: 'SHARE_REVOKED',
    });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('signale l’échec quand aucun message n’est parti', async () => {
    vi.mocked(sendMail).mockResolvedValue(false);
    await expect(sendShareMail(2, 4, ['x@studio.fr'], null)).rejects.toMatchObject({
      code: 'SMTP_SEND_FAILED',
    });
  });
});
