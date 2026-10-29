// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` is hoisted: the factory cannot capture a module variable. So it is created INSIDE the
// factory, then retrieved through the import.
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
 * The link used to be merely copied to the clipboard: the client received a bare URL, without knowing
 * what it opened or when it expired. These tests cover what the message says and what it does not do:
 * reveal the other recipients.
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
  // Two `href`s (the button and the fallback) plus the URL spelled out: many mail clients block
  // buttons, and some recipients copy the address by hand.
  it('carries the link in the button and in plain text as the fallback', () => {
    const html = renderShareMailHtml('en', ctx);
    expect(html.split(`href="${ctx.url}"`).length - 1).toBe(2);
    expect(html).toContain(`>${ctx.url}</a>`);
  });

  // The note comes from a free-text field of the supervisor: it is injected into HTML.
  it('escapes the note instead of rendering it', () => {
    const html = renderShareMailHtml('en', { ...ctx, note: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  // The project name is repeated in the message title, which `mailLayout` composes.
  // A supervisor can rename it: it is user data, not markup.
  it('escapes the project name all the way into the bold title', () => {
    const html = renderShareMailHtml('en', {
      ...ctx,
      projectName: 'Réf. <a href="https://faux.example">Ouvrir la review</a>',
    });
    expect(html).not.toContain('<a href="https://faux.example">');
    expect(html).toContain('&lt;a href=&quot;https://faux.example&quot;&gt;');
  });

  // The local copy of the escaping forgot quotes: the one that matters as soon as data
  // lands in an attribute.
  it('escapes quotes too, not only angle brackets', () => {
    const html = renderShareMailHtml('en', { ...ctx, note: 'x" onmouseover="alert(1)' });
    expect(html).not.toContain('onmouseover="');
    expect(html).toContain('&quot;');
  });

  it('omits the note block when there is none', () => {
    expect(renderShareMailHtml('en', ctx)).not.toContain('padding-left:12px');
  });

  // Two distinct keys: the message always states the expiry situation, and never says
  // the same thing in both cases.
  it('distinguishes a link that expires from one that does not', () => {
    const withDate = renderShareMailHtml('en', { ...ctx, expiresAt: new Date('2026-09-01T00:00:00Z') });
    expect(withDate).not.toBe(renderShareMailHtml('en', ctx));
  });

  it('mentions the view limit and the password only if they exist', () => {
    const plain = renderShareMailHtml('en', ctx);
    expect(renderShareMailHtml('en', { ...ctx, maxViews: 3 })).not.toBe(plain);
    expect(renderShareMailHtml('en', { ...ctx, hasPassword: true })).not.toBe(plain);
  });
});

describe('scopeLine', () => {
  it('says something different for each scope', () => {
    const lines = [ShareScope.PROJECT, ShareScope.PLAYLIST, ShareScope.VERSION, ShareScope.MEDIA].map((s) =>
      scopeLine('en', { scope: s, scopeTarget: 'Reel 1' }),
    );
    expect(new Set(lines).size).toBe(4);
  });
});

describe('shareUrl', () => {
  it('builds the public URL from APP_URL', () => {
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

  // A plain list in `To:` reveals every other recipient's address to each client.
  it('sends one message per recipient', async () => {
    await expect(sendShareMail(2, 4, ['x@studio.fr', 'y@client.com'], null)).resolves.toEqual({ sent: 2 });
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendMail).mock.calls.map((c) => c[0])).toEqual(['x@studio.fr', 'y@client.com']);
  });

  it('refuses early without a public URL', async () => {
    envMock.APP_URL = undefined;
    await expect(sendShareMail(2, 4, ['x@studio.fr'], null)).rejects.toMatchObject({
      code: 'APP_URL_MISSING',
    });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('refuses early without an SMTP relay', async () => {
    vi.mocked(isMailerConfigured).mockResolvedValue(false);
    await expect(sendShareMail(2, 4, ['x@studio.fr'], null)).rejects.toMatchObject({
      code: 'SMTP_NOT_CONFIGURED',
    });
  });

  it('refuses to send a revoked link', async () => {
    vi.mocked(prisma.shareLink.findUnique).mockResolvedValue({ ...link, revoked: true } as never);
    await expect(sendShareMail(2, 4, ['x@studio.fr'], null)).rejects.toMatchObject({
      code: 'SHARE_REVOKED',
    });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('reports the failure when no message was sent', async () => {
    vi.mocked(sendMail).mockResolvedValue(false);
    await expect(sendShareMail(2, 4, ['x@studio.fr'], null)).rejects.toMatchObject({
      code: 'SMTP_SEND_FAILED',
    });
  });
});
