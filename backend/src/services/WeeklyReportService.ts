// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { isMailerConfigured, sendMail } from '../lib/mailer';
import { unsubscribeUrl } from '../lib/unsubscribe';
import { mailLayout, MAIL_ACCENT, MAIL_BORDER, MAIL_MUTED } from '../lib/mailTemplate';
import { resolveUserLocale } from '../lib/settings';
import { formatTag, t, type Locale } from '../i18n';
import { displayName } from '../lib/userView';
import { env } from '../config/env';
import { escapeHtml as esc } from '../lib/html';

/**
 * Weekly activity report (43.B, issue #124): studio summary per project (published versions, decisions, open notes)
 * over 7 days, sent to supervisors/admins who enabled `preferences.weeklyReport`. Scheduled from server.ts.
 */

export interface ProjectWeekly {
  projectId: number;
  projectName: string;
  publishedVersions: number;
  approved: number;
  retakes: number;
  otherDecisions: number;
  openNotes: number;
}

/** "Version attached to this project" filter (3 paths: shot, task asset, direct asset). */
const inProject = (projectId: number): Prisma.VersionWhereInput => ({
  OR: [{ task: { OR: [{ shot: { projectId } }, { asset: { projectId } }] } }, { asset: { projectId } }],
});

/** Summary of a project over the window; null if there is no activity and no open note. */
async function buildProjectWeekly(
  projectId: number,
  projectName: string,
  since: Date,
): Promise<ProjectWeekly | null> {
  const versionInProject = inProject(projectId);
  const [publishedVersions, decisions, openNotes] = await Promise.all([
    prisma.version.count({
      where: {
        deletedAt: null,
        ...versionInProject,
        media: { some: { published: true, createdAt: { gte: since } } },
      },
    }),
    prisma.reviewDecision.findMany({
      where: { createdAt: { gte: since }, version: versionInProject },
      select: { status: { select: { isApproval: true, isRetake: true } } },
    }),
    prisma.comment.count({
      where: { parentId: null, isResolved: false, media: { deletedAt: null, version: versionInProject } },
    }),
  ]);

  const approved = decisions.filter((d) => d.status.isApproval).length;
  const retakes = decisions.filter((d) => d.status.isRetake).length;
  const otherDecisions = decisions.length - approved - retakes;

  if (publishedVersions === 0 && decisions.length === 0 && openNotes === 0) return null;
  return { projectId, projectName, publishedVersions, approved, retakes, otherDecisions, openNotes };
}

/** Full studio report: one block per active project with activity. */
export async function buildWeeklyReport(since: Date): Promise<ProjectWeekly[]> {
  const projects = await prisma.project.findMany({
    where: { deletedAt: null, status: { not: 'ARCHIVED' } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  const out: ProjectWeekly[] = [];
  for (const p of projects) {
    const w = await buildProjectWeekly(p.id, p.name, since);
    if (w) out.push(w);
  }
  return out;
}

const fmt = (d: Date, locale: Locale) =>
  d.toLocaleDateString(formatTag(locale), { day: 'numeric', month: 'long' });

/** HTML of the report (pure: unit-tested). */
export function renderWeeklyReportHtml(
  locale: Locale,
  userName: string,
  projects: ProjectWeekly[],
  weekStart: Date,
  weekEnd: Date,
): string {
  const cell = (v: number, accent = false) =>
    `<td style="padding:6px 10px;text-align:right;${accent && v > 0 ? 'font-weight:600' : ''}">${v}</td>`;
  const rows = projects
    .map((p) => {
      const link = env.APP_URL
        ? `<a href="${env.APP_URL}/projects/${p.projectId}" style="color:${MAIL_ACCENT};text-decoration:none">${esc(p.projectName)}</a>`
        : esc(p.projectName);
      return `<tr style="border-top:1px solid ${MAIL_BORDER}">
<td style="padding:6px 10px">${link}</td>
${cell(p.publishedVersions)}${cell(p.approved)}${cell(p.retakes, true)}${cell(p.openNotes, true)}
</tr>`;
    })
    .join('');
  const table = `<table style="width:100%;border-collapse:collapse;font-size:13px;margin:12px 0">
<thead><tr style="color:${MAIL_MUTED};text-align:right">
<th style="padding:6px 10px;text-align:left">${t(locale, 'weekly.column.project')}</th>
<th style="padding:6px 10px">${t(locale, 'weekly.column.published')}</th>
<th style="padding:6px 10px">${t(locale, 'weekly.column.approvals')}</th>
<th style="padding:6px 10px">${t(locale, 'weekly.column.retakes')}</th>
<th style="padding:6px 10px">${t(locale, 'weekly.column.openNotes')}</th>
</tr></thead><tbody>${rows}</tbody></table>`;
  const greeting = t(locale, 'weekly.greeting', {
    name: userName,
    from: fmt(weekStart, locale),
    to: fmt(weekEnd, locale),
  });
  const content = `<p>${esc(greeting)}</p>
${projects.length ? table : `<p>${t(locale, 'weekly.empty')}</p>`}
<p style="color:${MAIL_MUTED};font-size:12px">${t(locale, 'weekly.optOut')}</p>`;
  return mailLayout(
    locale,
    t(locale, 'weekly.title'),
    content,
    t(locale, 'weekly.preview', { count: projects.length }),
  );
}

/** Sends the weekly report to subscribed supervisors/admins (`preferences.weeklyReport`). */
export async function sendWeeklyReports(now = new Date()): Promise<number> {
  if (!(await isMailerConfigured())) {
    logger.info('[WeeklyReport] SMTP non configuré : envoi hebdo sauté');
    return 0;
  }
  const recipients = await prisma.user.findMany({
        // Service accounts excluded: non-routable address (see ApiTokenService).
    where: { role: { in: [Role.SUPERVISOR, Role.ADMIN] }, isService: false },
    select: {
      email: true,
      name: true,
      username: true,
      firstName: true,
      lastName: true,
      id: true,
      preferences: true,
    },
  });
  const optedIn = recipients.filter(
    (u) => (u.preferences as Record<string, unknown> | null)?.weeklyReport === true,
  );
  if (optedIn.length === 0) return 0;

  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const projects = await buildWeeklyReport(since); // studio-wide, built only once
  if (projects.length === 0) {
    logger.info('[WeeklyReport] aucune activité cette semaine : envoi sauté');
    return 0;
  }
  let sent = 0;
  for (const u of optedIn) {
    const locale = await resolveUserLocale(u.preferences);
    const html = renderWeeklyReportHtml(locale, displayName(u), projects, since, now);
    const sentOk = await sendMail(u.email, t(locale, 'weekly.subject'), html, {
      unsubscribeUrl: unsubscribeUrl(u.id, 'weeklyReport') ?? undefined,
    });
    if (sentOk) sent += 1;
  }
  logger.info(`[WeeklyReport] ${sent} rapport(s) envoyé(s)`);
  return sent;
}
