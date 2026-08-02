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
  it('liste les projets, échappe le HTML et lie via APP_URL', () => {
    const html = renderWeeklyReportHtml(
      'Yvig',
      projects,
      new Date('2026-07-13T07:00:00'),
      new Date('2026-07-20T07:00:00'),
    );
    expect(html).toContain('Bonjour Yvig');
    expect(html).toContain('Projet &lt;Démo&gt;');
    expect(html).toContain('https://review.studio/projects/7');
    expect(html).toContain('Rapport hebdomadaire de production');
    expect(html).toContain('Versions publiées');
    expect(html).toContain('Notes ouvertes');
  });

  it('affiche un message quand aucune activité', () => {
    const html = renderWeeklyReportHtml('Yvig', [], new Date(), new Date());
    expect(html).toContain('Aucune activité cette semaine');
  });
});

describe('WeeklyReportService — envoi', () => {
  it('saute proprement quand SMTP n’est pas configuré', async () => {
    await expect(sendWeeklyReports()).resolves.toBe(0);
  });
});
