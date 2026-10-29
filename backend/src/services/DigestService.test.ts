// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('../lib/mailer', () => ({ isMailerConfigured: () => false, sendMail: vi.fn() }));
vi.mock('../config/env', () => ({
  env: { APP_URL: 'https://review.studio', DIGEST_HOUR: 7 },
}));

import { excerptOf, renderDigestHtml, sendDailyDigests, type ProjectDigest } from './DigestService';

describe('DigestService: comment excerpt', () => {
  it('strips the HTML and normalises whitespace', () => {
    expect(excerptOf('<p>Trop  <strong>sombre</strong>&nbsp;ici</p>')).toBe('Trop sombre ici');
  });

  it('truncates beyond the limit', () => {
    const out = excerptOf('x'.repeat(300));
    expect(out.length).toBe(120);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('DigestService: HTML rendering', () => {
  const digest: ProjectDigest = {
    projectId: 5,
    projectName: 'Projet <Démo>',
    versions: [{ label: 'V02 — SH010 · anim', author: 'Ada' }],
    media: [{ label: 'plan.mp4 (V02)', uploader: 'Ada' }],
    comments: [{ author: 'Grace', excerpt: 'À revoir', mediaName: 'plan.mp4' }],
  };

  it('contains the sections, escapes the HTML and links the project via APP_URL', () => {
    const html = renderDigestHtml('en', 'Yvig', [digest], new Date('2026-07-11T07:00:00'));
    expect(html).toContain('Hello Yvig');
    expect(html).toContain('Projet &lt;Démo&gt;');
    expect(html).toContain('https://review.studio/projects/5');
    expect(html).toContain('New versions (1)');
    expect(html).toContain('Published media (1)');
    expect(html).toContain('Comments (1)');
    expect(html).toContain('Grace');
  });

  it('omits empty sections', () => {
    const html = renderDigestHtml('en', 'Yvig', [{ ...digest, versions: [], media: [] }], new Date());
    expect(html).not.toContain('New versions');
    expect(html).not.toContain('Published media');
    expect(html).toContain('Comments (1)');
  });

  it('renders the digest in the recipient\'s language, footer included', () => {
    const html = renderDigestHtml('fr', 'Yvig', [digest], new Date('2026-07-11T07:00:00'));
    expect(html).toContain('lang="fr"');
    expect(html).toContain('Bonjour Yvig');
    expect(html).toContain('Nouvelles versions (1)');
    expect(html).toContain('plateforme de review collaborative');
  });

  it('dates the digest in the recipient\'s language', () => {
    const day = new Date('2026-07-11T07:00:00');
    expect(renderDigestHtml('en', 'Yvig', [digest], day)).toContain('July');
    expect(renderDigestHtml('fr', 'Yvig', [digest], day)).toContain('juillet');
    expect(renderDigestHtml('ja', 'Yvig', [digest], day)).toContain('7月');
  });

  // Business vocabulary is not translated: an artist reads "version" in every language, even where the rest
  // of the sentence changes alphabet.
  it('keeps the business vocabulary in English', () => {
    expect(renderDigestHtml('ja', 'Yvig', [digest], new Date())).toContain('新しい version');
  });
});

describe('DigestService: sending', () => {
  it('skips cleanly when SMTP is not configured', async () => {
    await expect(sendDailyDigests()).resolves.toBe(0);
  });
});
