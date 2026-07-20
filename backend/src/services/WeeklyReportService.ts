import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { isMailerConfigured, sendMail } from '../lib/mailer';
import { mailLayout, MAIL_ACCENT } from '../lib/mailTemplate';
import { displayName } from '../lib/userView';
import { env } from '../config/env';

/**
 * Rapport d'activité hebdomadaire (43.B — №124) : synthèse studio par projet
 * (versions publiées, décisions, notes ouvertes) sur 7 jours, envoyée aux
 * superviseurs/admins ayant activé `preferences.weeklyReport`. Planifié depuis server.ts.
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

/** Filtre « version rattachée à ce projet » (3 chemins : shot, asset de tâche, asset direct). */
const inProject = (projectId: number): Prisma.VersionWhereInput => ({
  OR: [{ task: { OR: [{ shot: { projectId } }, { asset: { projectId } }] } }, { asset: { projectId } }],
});

/** Synthèse d'un projet sur la fenêtre ; null si aucune activité ni note ouverte. */
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

/** Rapport studio complet : un bloc par projet actif ayant de l'activité. */
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

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

/** HTML du rapport (pur — testé unitairement). */
export function renderWeeklyReportHtml(
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
      return `<tr style="border-top:1px solid #1f2937">
<td style="padding:6px 10px">${link}</td>
${cell(p.publishedVersions)}${cell(p.approved)}${cell(p.retakes, true)}${cell(p.openNotes, true)}
</tr>`;
    })
    .join('');
  const table = `<table style="width:100%;border-collapse:collapse;font-size:13px;margin:12px 0">
<thead><tr style="color:#9ca3af;text-align:right">
<th style="padding:6px 10px;text-align:left">Projet</th>
<th style="padding:6px 10px">Versions publiées</th>
<th style="padding:6px 10px">Approbations</th>
<th style="padding:6px 10px">Retakes</th>
<th style="padding:6px 10px">Notes ouvertes</th>
</tr></thead><tbody>${rows}</tbody></table>`;
  const content = `<p>Bonjour ${esc(userName)}, voici l'activité de production du ${fmt(weekStart)} au ${fmt(weekEnd)} :</p>
${projects.length ? table : '<p>Aucune activité cette semaine.</p>'}
<p style="color:#6b7280;font-size:12px">Vous recevez ce rapport car il est activé dans votre profil ReView (superviseurs).</p>`;
  return mailLayout('Rapport hebdomadaire de production', content);
}

/** Envoie le rapport hebdo aux superviseurs/admins abonnés (`preferences.weeklyReport`). */
export async function sendWeeklyReports(now = new Date()): Promise<number> {
  if (!(await isMailerConfigured())) {
    logger.info('[WeeklyReport] SMTP non configuré : envoi hebdo sauté');
    return 0;
  }
  const recipients = await prisma.user.findMany({
    where: { role: { in: [Role.SUPERVISOR, Role.ADMIN] } },
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
  const projects = await buildWeeklyReport(since); // studio-wide, construit une seule fois
  if (projects.length === 0) {
    logger.info('[WeeklyReport] aucune activité cette semaine : envoi sauté');
    return 0;
  }
  let sent = 0;
  for (const u of optedIn) {
    const html = renderWeeklyReportHtml(displayName(u), projects, since, now);
    if (await sendMail(u.email, 'ReView — rapport hebdomadaire de production', html)) sent += 1;
  }
  logger.info(`[WeeklyReport] ${sent} rapport(s) envoyé(s)`);
  return sent;
}
