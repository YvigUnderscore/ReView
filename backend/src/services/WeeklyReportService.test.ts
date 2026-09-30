// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('../lib/mailer', () => ({ isMailerConfigured: () => false, sendMail: vi.fn() }));
vi.mock('../config/env', () => ({ env: { APP_URL: 'https://review.studio' } }));

import { renderWeeklyReportHtml, sendWeeklyReports, type ProjectWeekly } from './WeeklyReportService';

const projects: ProjectWeekly[] = [
  {
    projectId: 7,
    projectName: 'Projet <Démo>',
    publishedVersions: 3,
    approved: 2,
    retakes: 1,
    otherDecisions: 0,
    openNotes: 4,
  },
];

describe('WeeklyReportService — rendu HTML', () => {
  const weekStart = new Date('2026-07-13T07:00:00');
  const weekEnd = new Date('2026-07-20T07:00:00');

  it('liste les projets, échappe le HTML et lie via APP_URL', () => {
    const html = renderWeeklyReportHtml('en', 'Yvig', projects, weekStart, weekEnd);
    expect(html).toContain('Hello Yvig');
    expect(html).toContain('Projet &lt;Démo&gt;');
    expect(html).toContain('https://review.studio/projects/7');
    expect(html).toContain('Weekly production report');
    expect(html).toContain('Published versions');
    expect(html).toContain('Open notes');
  });

  it('affiche un message quand aucune activité', () => {
    const html = renderWeeklyReportHtml('en', 'Yvig', [], new Date(), new Date());
    expect(html).toContain('No activity this week');
  });

  it('rend le rapport dans la langue du destinataire, dates comprises', () => {
    const html = renderWeeklyReportHtml('fr', 'Yvig', projects, weekStart, weekEnd);
    expect(html).toContain('lang="fr"');
    expect(html).toContain('Rapport hebdomadaire de production');
    expect(html).toContain('Versions publiées');
    expect(html).toContain('13 juillet');
  });

  // « Retakes » est du vocabulaire de production : il reste en anglais partout.
  it('garde « Retakes » intact dans toutes les langues', () => {
    for (const locale of ['en', 'fr', 'ja', 'br'] as const) {
      expect(renderWeeklyReportHtml(locale, 'Yvig', projects, weekStart, weekEnd)).toContain('Retakes');
    }
  });
});

describe('WeeklyReportService — envoi', () => {
  it('saute proprement quand SMTP n’est pas configuré', async () => {
    await expect(sendWeeklyReports()).resolves.toBe(0);
  });
});
