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

describe('WeeklyReportService: HTML rendering', () => {
  const weekStart = new Date('2026-07-13T07:00:00');
  const weekEnd = new Date('2026-07-20T07:00:00');

  it('lists the projects, escapes the HTML and links via APP_URL', () => {
    const html = renderWeeklyReportHtml('en', 'Yvig', projects, weekStart, weekEnd);
    expect(html).toContain('Hello Yvig');
    expect(html).toContain('Projet &lt;Démo&gt;');
    expect(html).toContain('https://review.studio/projects/7');
    expect(html).toContain('Weekly production report');
    expect(html).toContain('Published versions');
    expect(html).toContain('Open notes');
  });

  it('shows a message when there is no activity', () => {
    const html = renderWeeklyReportHtml('en', 'Yvig', [], new Date(), new Date());
    expect(html).toContain('No activity this week');
  });

  it('renders the report in the recipient\'s language, dates included', () => {
    const html = renderWeeklyReportHtml('fr', 'Yvig', projects, weekStart, weekEnd);
    expect(html).toContain('lang="fr"');
    expect(html).toContain('Rapport hebdomadaire de production');
    expect(html).toContain('Versions publiées');
    expect(html).toContain('13 juillet');
  });

    // "Retakes" is production vocabulary: it stays in English everywhere.
  it('keeps "Retakes" intact in all languages', () => {
    for (const locale of ['en', 'fr', 'ja', 'br'] as const) {
      expect(renderWeeklyReportHtml(locale, 'Yvig', projects, weekStart, weekEnd)).toContain('Retakes');
    }
  });
});

describe('WeeklyReportService: sending', () => {
  it('skips cleanly when SMTP is not configured', async () => {
    await expect(sendWeeklyReports()).resolves.toBe(0);
  });
});
