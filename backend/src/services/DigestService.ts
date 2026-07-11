import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { isMailerConfigured, sendMail } from '../lib/mailer';
import { displayName } from '../lib/userView';

/**
 * Digest email quotidien (backlog P2 10.G) : résumé des activités de la veille,
 * par projet, envoyé aux utilisateurs ayant activé `preferences.emailDigest`.
 * Déclenché par le scheduler du serveur (cf. server.ts, DIGEST_HOUR).
 */

export interface ProjectDigest {
  projectId: number;
  projectName: string;
  versions: { label: string; author: string }[];
  media: { label: string; uploader: string }[];
  comments: { author: string; excerpt: string; mediaName: string }[];
}

/** Texte brut borné à partir d'un contenu HTML de commentaire. */
export function excerptOf(html: string, max = 120): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Activité d'un projet depuis `since` (versions créées, médias publiés, commentaires). */
async function buildProjectDigest(
  projectId: number,
  projectName: string,
  since: Date,
): Promise<ProjectDigest | null> {
  const inProject = {
    OR: [{ task: { OR: [{ shot: { projectId } }, { asset: { projectId } }] } }, { asset: { projectId } }],
  };
  const [versions, media, comments] = await Promise.all([
    prisma.version.findMany({
      where: { deletedAt: null, createdAt: { gte: since }, ...inProject },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        name: true,
        author: {
          select: { name: true, username: true, firstName: true, lastName: true, email: true, id: true },
        },
        task: { select: { name: true, shot: { select: { code: true } }, asset: { select: { name: true } } } },
        asset: { select: { name: true } },
      },
    }),
    prisma.mediaObject.findMany({
      where: { deletedAt: null, published: true, createdAt: { gte: since }, version: inProject },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        originalName: true,
        uploader: {
          select: { name: true, username: true, firstName: true, lastName: true, email: true, id: true },
        },
        version: { select: { name: true } },
      },
    }),
    prisma.comment.findMany({
      where: { createdAt: { gte: since }, media: { deletedAt: null, version: inProject } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        content: true,
        guestName: true,
        author: {
          select: { name: true, username: true, firstName: true, lastName: true, email: true, id: true },
        },
        media: { select: { originalName: true } },
      },
    }),
  ]);
  if (versions.length === 0 && media.length === 0 && comments.length === 0) return null;

  const who = (u: { id: number; email: string } | null, guest?: string | null) =>
    u ? displayName(u) : (guest ?? 'Anonyme');
  return {
    projectId,
    projectName,
    versions: versions.map((v) => ({
      label: `${v.name} — ${v.task ? `${v.task.shot?.code ?? v.task.asset?.name ?? ''} · ${v.task.name}` : (v.asset?.name ?? '')}`,
      author: who(v.author),
    })),
    media: media.map((m) => ({
      label: `${m.originalName} (${m.version.name})`,
      uploader: who(m.uploader),
    })),
    comments: comments.map((c) => ({
      author: who(c.author, c.guestName),
      excerpt: excerptOf(c.content),
      mediaName: c.media.originalName,
    })),
  };
}

/** Digest complet d'un utilisateur : un bloc par projet dont il est membre, actifs seulement. */
export async function buildUserDigest(userId: number, since: Date): Promise<ProjectDigest[]> {
  const memberships = await prisma.projectMembership.findMany({
    where: { userId, project: { deletedAt: null } },
    select: { project: { select: { id: true, name: true } } },
  });
  const digests: ProjectDigest[] = [];
  for (const { project } of memberships) {
    const d = await buildProjectDigest(project.id, project.name, since);
    if (d) digests.push(d);
  }
  return digests;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** HTML de l'email (pur — testé unitairement). */
export function renderDigestHtml(userName: string, digests: ProjectDigest[], date: Date): string {
  const day = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const blocks = digests
    .map((d) => {
      const link = env.APP_URL ? `${env.APP_URL}/projects/${d.projectId}` : null;
      const title = link
        ? `<a href="${link}" style="color:#e8590c;text-decoration:none">${esc(d.projectName)}</a>`
        : esc(d.projectName);
      const list = (label: string, items: string[]) =>
        items.length
          ? `<p style="margin:8px 0 2px;font-weight:600">${label} (${items.length})</p><ul style="margin:2px 0 10px;padding-left:18px">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`
          : '';
      return `<div style="margin:18px 0;padding:14px;border:1px solid #e5e5e5;border-radius:8px">
<h2 style="margin:0 0 6px;font-size:16px">${title}</h2>
${list(
  'Nouvelles versions',
  d.versions.map((v) => `${esc(v.label)} <span style="color:#888">par ${esc(v.author)}</span>`),
)}
${list(
  'Médias publiés',
  d.media.map((m) => `${esc(m.label)} <span style="color:#888">par ${esc(m.uploader)}</span>`),
)}
${list(
  'Commentaires',
  d.comments.map((c) => `<strong>${esc(c.author)}</strong> sur ${esc(c.mediaName)} : « ${esc(c.excerpt)} »`),
)}
</div>`;
    })
    .join('');
  return `<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:640px;margin:0 auto;color:#222">
<h1 style="font-size:18px">ReView — digest du ${day}</h1>
<p>Bonjour ${esc(userName)}, voici l'activité des dernières 24 heures sur vos projets :</p>
${blocks}
<p style="color:#888;font-size:12px">Vous recevez cet email car le digest quotidien est activé dans votre profil ReView.</p>
</div>`;
}

/** Envoie le digest quotidien à tous les abonnés (préférence `emailDigest`). */
export async function sendDailyDigests(now = new Date()): Promise<number> {
  if (!isMailerConfigured()) {
    logger.info('[Digest] SMTP non configuré : envoi quotidien sauté');
    return 0;
  }
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      username: true,
      firstName: true,
      lastName: true,
      preferences: true,
    },
  });
  let sent = 0;
  for (const u of users) {
    const prefs = (u.preferences ?? {}) as Record<string, unknown>;
    if (prefs.emailDigest !== true) continue;
    const digests = await buildUserDigest(u.id, since);
    if (digests.length === 0) continue;
    const html = renderDigestHtml(displayName(u), digests, now);
    if (await sendMail(u.email, `ReView — activité de vos projets`, html)) sent += 1;
  }
  logger.info(`[Digest] ${sent} email(s) envoyé(s)`);
  return sent;
}
