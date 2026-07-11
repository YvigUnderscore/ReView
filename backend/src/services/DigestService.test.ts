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
    const html = renderDigestHtml('Yvig', [digest], new Date('2026-07-11T07:00:00'));
    expect(html).toContain('Bonjour Yvig');
    expect(html).toContain('Projet &lt;Démo&gt;');
    expect(html).toContain('https://review.studio/projects/5');
    expect(html).toContain('Nouvelles versions (1)');
    expect(html).toContain('Médias publiés (1)');
    expect(html).toContain('Commentaires (1)');
    expect(html).toContain('Grace');
  });

  it('omet les sections vides', () => {
    const html = renderDigestHtml('Yvig', [{ ...digest, versions: [], media: [] }], new Date());
    expect(html).not.toContain('Nouvelles versions');
    expect(html).not.toContain('Médias publiés');
    expect(html).toContain('Commentaires (1)');
  });
});

describe('DigestService — envoi', () => {
  it('saute proprement quand SMTP n’est pas configuré', async () => {
    await expect(sendDailyDigests()).resolves.toBe(0);
  });
});
