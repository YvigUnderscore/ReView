// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('../lib/mailer', () => ({ isMailerConfigured: () => false, sendMail: vi.fn() }));
vi.mock('../config/env', () => ({
  env: { APP_URL: 'https://review.studio', DIGEST_HOUR: 7 },
}));

import { excerptOf, renderDigestHtml, sendDailyDigests, type ProjectDigest } from './DigestService';

describe('DigestService — extrait de commentaire', () => {
  it('supprime le HTML et normalise les espaces', () => {
    expect(excerptOf('<p>Trop  <strong>sombre</strong>&nbsp;ici</p>')).toBe('Trop sombre ici');
  });

  it('tronque au-delà de la limite', () => {
    const out = excerptOf('x'.repeat(300));
    expect(out.length).toBe(120);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('DigestService — rendu HTML', () => {
  const digest: ProjectDigest = {
    projectId: 5,
    projectName: 'Projet <Démo>',
    versions: [{ label: 'V02 — SH010 · anim', author: 'Ada' }],
    media: [{ label: 'plan.mp4 (V02)', uploader: 'Ada' }],
    comments: [{ author: 'Grace', excerpt: 'À revoir', mediaName: 'plan.mp4' }],
  };

  it('contient les sections, échappe le HTML et lie le projet via APP_URL', () => {
    const html = renderDigestHtml('en', 'Yvig', [digest], new Date('2026-07-11T07:00:00'));
    expect(html).toContain('Hello Yvig');
    expect(html).toContain('Projet &lt;Démo&gt;');
    expect(html).toContain('https://review.studio/projects/5');
    expect(html).toContain('New versions (1)');
    expect(html).toContain('Published media (1)');
    expect(html).toContain('Comments (1)');
    expect(html).toContain('Grace');
  });

  it('omet les sections vides', () => {
    const html = renderDigestHtml('en', 'Yvig', [{ ...digest, versions: [], media: [] }], new Date());
    expect(html).not.toContain('New versions');
    expect(html).not.toContain('Published media');
    expect(html).toContain('Comments (1)');
  });

  it('rend le digest dans la langue du destinataire, pied compris', () => {
    const html = renderDigestHtml('fr', 'Yvig', [digest], new Date('2026-07-11T07:00:00'));
    expect(html).toContain('lang="fr"');
    expect(html).toContain('Bonjour Yvig');
    expect(html).toContain('Nouvelles versions (1)');
    expect(html).toContain('plateforme de review collaborative');
  });

  it('date le digest dans la langue du destinataire', () => {
    const day = new Date('2026-07-11T07:00:00');
    expect(renderDigestHtml('en', 'Yvig', [digest], day)).toContain('July');
    expect(renderDigestHtml('fr', 'Yvig', [digest], day)).toContain('juillet');
    expect(renderDigestHtml('ja', 'Yvig', [digest], day)).toContain('7月');
  });

  // Le vocabulaire métier ne se traduit pas : un artiste lit « version » dans toutes
  // les langues, y compris là où le reste de la phrase change d'alphabet.
  it('garde le vocabulaire métier en anglais', () => {
    expect(renderDigestHtml('ja', 'Yvig', [digest], new Date())).toContain('新しい version');
  });
});

describe('DigestService — envoi', () => {
  it('saute proprement quand SMTP n’est pas configuré', async () => {
    await expect(sendDailyDigests()).resolves.toBe(0);
  });
});
