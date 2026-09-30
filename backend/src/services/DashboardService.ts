// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma, Role, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { familyOf, statusRefOf, taskPriority } from '../lib/statusFamily';
import {
  accessibleProjects,
  awaitingMyReviewWhere,
  commentFeedWhere,
  mediaInReviewWhere,
  myOpenTasksWhere,
  myRetakesWhere,
  publishedMediaInScope,
  versionInProjects,
  type SessionUser,
} from '../lib/homeScope';
import { storage } from './StorageService';
import { effectiveThumbnailUrl, firstMediaThumbKeysForProjects } from '../lib/thumbnails';

/**
 * Données de la page Accueil (12.B) : dernières reviews commentées, flux d'activité,
 * mes tâches assignées et statistiques — le tout borné à « mes projets »
 * (ADMIN/SUPERVISOR voient tout, sinon filtre par membership, motif lib/search.ts).
 *
 * Trois corrections d'échelle par rapport à la version d'origine.
 *
 * « Dernières reviews » rapatriait toute la table Comment du studio pour en afficher six
 * lignes — le `distinct` de Prisma n'existe pas en SQL. L'élection est passée en base
 * (`latestCommentPerMedia` ci-dessous).
 *
 * La progression des projets récents coûtait deux `count` corrélés PAR projet, soit dix
 * requêtes sur les vingt-trois de l'ouverture d'accueil, pour chaque utilisateur et à
 * chaque affichage. Un seul agrégat les remplace.
 *
 * Et les compteurs raisonnaient sur l'enum figé `TaskStatus` : un studio relié à ShotGrid
 * voyait « mes retakes » et la jauge de chaque projet calculés sur six seaux qui ne sont pas
 * son vocabulaire. Ils lisent désormais `PipelineStatus` (`lib/statusFamily`), avec repli
 * sur l'enum quand aucun statut personnalisable n'est posé.
 *
 * Les quatre compteurs de l'Accueil, enfin, ne sont plus écrits ici : leurs périmètres
 * vivent dans `lib/homeScope`, avec les pages que les cartes ouvrent. Chacun mentait à sa
 * façon — « mes retakes » sans aucune borne, « awaiting review » posé comme personnel mais
 * calculé pour tout le studio, « media in review » comptant le publié décision comprise.
 * Un chiffre et la vue qui le déplie lisent maintenant le même `where`.
 */

/** Localisation lisible d'une tâche (SQ010 · SH020 ou nom d'asset). */
function loc(
  t: {
    shot?: { code: string; sequence?: { code: string } | null } | null;
    asset?: { name: string } | null;
  } | null,
): string {
  if (!t) return '';
  if (t.shot) return `${t.shot.sequence ? t.shot.sequence.code + ' · ' : ''}${t.shot.code}`;
  if (t.asset) return t.asset.name;
  return '';
}

const versionSelect = {
  select: {
    name: true,
    task: {
      select: {
        id: true,
        name: true,
        shot: { select: { code: true, sequence: { select: { code: true } } } },
        asset: { select: { name: true } },
      },
    },
    asset: { select: { name: true } },
  },
} as const;

/** Nombre de médias montrés dans « Dernières reviews ». */
const LATEST_REVIEWS = 6;

/**
 * Le dernier commentaire de chacun des six médias les plus récemment commentés.
 *
 * La lecture d'origine combinait `distinct: ['mediaObjectId']` et `take: 6`. Prisma 5 n'a
 * pas de traduction SQL pour `distinct` : il le résout dans le moteur de requête, ce qui
 * neutralise aussi le `take`. Le SQL émis partait donc SANS `LIMIT` — toute la table
 * Comment du studio traversait le réseau, colonnes `annotation`, `cameraState` et
 * `attachments` comprises, pour qu'on en garde six lignes. Mesuré à 50 000 commentaires :
 * 40 038 lignes rapatriées, 830 ms, à chaque ouverture d'accueil de chaque compte.
 *
 * L'élection passe donc en SQL : un agrégat `GROUP BY "mediaObjectId"` trié sur
 * `MAX("createdAt")` avec un vrai `LIMIT 6` (six lignes rapatriées quelle que soit
 * l'ancienneté du studio), puis une seconde lecture qui va chercher ces six commentaires
 * et seulement les colonnes affichées.
 *
 * `commentWhere` est repassé tel quel aux deux requêtes plutôt que réécrit en SQL : c'est
 * lui qui borne un CLIENT aux notes qui lui sont destinées, et un périmètre d'accès décrit
 * à deux endroits finit par diverger — ce serait une fuite, pas une optimisation.
 */
async function latestCommentPerMedia(commentWhere: Prisma.CommentWhereInput) {
  const latest = await prisma.comment.groupBy({
    by: ['mediaObjectId'],
    where: commentWhere,
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: 'desc' } },
    take: LATEST_REVIEWS,
  });
  // `createdAt` n'est jamais nul et un groupe n'est jamais vide : le filtre ne fait que
  // rendre l'absence de date représentable sans assertion.
  const pairs = latest.flatMap((g) =>
    g._max.createdAt ? [{ mediaObjectId: g.mediaObjectId, createdAt: g._max.createdAt }] : [],
  );
  if (pairs.length === 0) return [];
  const rows = await prisma.comment.findMany({
    where: { AND: [commentWhere, { OR: pairs }] },
    // Même ordre qu'avant (du plus récent au plus ancien) ; `id` départage deux notes
    // posées sur le même média à la milliseconde près, que l'ancienne lecture laissait
    // départager par le plan d'exécution.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      mediaObjectId: true,
      content: true,
      timestamp: true,
      createdAt: true,
      guestName: true,
      author: { select: { id: true, name: true } },
      media: {
        select: { id: true, kind: true, originalName: true, thumbnailKey: true, version: versionSelect },
      },
    },
  });
  // Un média ne paraît qu'une fois : sa note la plus récente, comme le faisait `distinct`.
  const seen = new Set<number>();
  const out: typeof rows = [];
  for (const row of rows) {
    if (seen.has(row.mediaObjectId)) continue;
    seen.add(row.mediaObjectId);
    out.push(row);
  }
  return out;
}

/** Une ligne de l'agrégat de progression : un projet, un statut, un compte. */
interface ProjectTaskCount {
  projectId: number;
  status: TaskStatus;
  isDone: boolean | null;
  isInactive: boolean | null;
  legacyStatus: TaskStatus | null;
  count: number;
}

/**
 * Progression des projets récents en UNE requête : tâches par projet et par statut.
 *
 * Les statuts sont joints ici plutôt que relus ensuite — l'agrégat rend au plus quelques
 * dizaines de lignes (cinq projets × le vocabulaire du studio), là où le motif précédent
 * posait deux `count` corrélés par projet.
 */
async function taskCountsByProject(
  projectIds: number[],
): Promise<Map<number, { total: number; done: number }>> {
  const out = new Map<number, { total: number; done: number }>();
  if (projectIds.length === 0) return out;
  const rows = await prisma.$queryRaw<ProjectTaskCount[]>`
    SELECT COALESCE(sh."projectId", a."projectId") AS "projectId",
           t.status::text          AS "status",
           ps."isDone"             AS "isDone",
           ps."isInactive"         AS "isInactive",
           ps."legacyStatus"::text AS "legacyStatus",
           COUNT(*)::int           AS "count"
    FROM "Task" t
    LEFT JOIN "Shot" sh  ON sh.id = t."shotId"  AND sh."deletedAt" IS NULL AND sh."hiddenAt" IS NULL
    LEFT JOIN "Asset" a  ON a.id  = t."assetId" AND a."deletedAt" IS NULL AND a."hiddenAt" IS NULL
    LEFT JOIN "PipelineStatus" ps ON ps.id = t."pipelineStatusId"
    WHERE COALESCE(sh."projectId", a."projectId") IN (${Prisma.join(projectIds)})
    GROUP BY 1, 2, 3, 4, 5
  `;
  for (const row of rows) {
    const family = familyOf(row.status, statusRefOf(row));
    // Un statut inactif (omis, sans objet) ne pèse sur aucune jauge d'avancement.
    if (family === 'inactive') continue;
    const entry = out.get(row.projectId) ?? { total: 0, done: 0 };
    entry.total += row.count;
    if (family === 'done') entry.done += row.count;
    out.set(row.projectId, entry);
  }
  return out;
}

export async function getDashboard(user: SessionUser) {
  const access = accessibleProjects(user);
  // Les périmètres sont ceux de `lib/homeScope`, partagés avec les pages que les cartes
  // ouvrent : un compteur ne peut plus annoncer autre chose que ce que sa vue montre. Un
  // CLIENT y reste borné aux notes qui lui sont destinées.
  const mediaWhere = publishedMediaInScope(user);
  const commentWhere = commentFeedWhere(user);
  const inReviewWhere = mediaInReviewWhere(user);
  // Fenêtre des tendances : ce qui s'est ajouté sur les 7 derniers jours.
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  const [
    lastComments,
    versions,
    media,
    myTasks,
    projectCount,
    mediaInReview,
    commentCount,
    mediaInReview7d,
    commentCount7d,
    myRetakes,
    awaitingMyReview,
    recentProjectRows,
  ] = await Promise.all([
    // Dernier commentaire des six médias les plus récemment commentés (élection en SQL).
    latestCommentPerMedia(commentWhere),
    prisma.version.findMany({
      where: { deletedAt: null, ...versionInProjects(access) },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        author: { select: { id: true, name: true } },
        task: versionSelect.select.task,
        asset: { select: { name: true } },
      },
    }),
    prisma.mediaObject.findMany({
      where: mediaWhere,
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        uploader: { select: { id: true, name: true } },
        version: versionSelect,
      },
    }),
    prisma.task.findMany({
      // Mêmes bornes que le compteur de retakes : projet accessible, hors corbeille,
      // parent non masqué. Sans elles, l'Accueil réclamait du travail sur un plan retiré.
      where: myOpenTasksWhere(user),
      orderBy: { updatedAt: 'desc' },
      take: 24,
      include: {
        shot: { select: { projectId: true, code: true, sequence: { select: { code: true } } } },
        asset: { select: { projectId: true, name: true } },
        pipelineStatus: { select: { isDone: true, isInactive: true, legacyStatus: true } },
      },
    }),
    prisma.project.count({ where: access }),
    // Médias réellement en review : publiés, prêts, sans décision rendue.
    prisma.mediaObject.count({ where: inReviewWhere }),
    prisma.comment.count({ where: commentWhere }),
    // Tendances 7 jours — mêmes périmètres que les compteurs qu'elles accompagnent.
    prisma.mediaObject.count({ where: { ...inReviewWhere, createdAt: { gte: weekAgo } } }),
    prisma.comment.count({ where: { ...commentWhere, createdAt: { gte: weekAgo } } }),
    // Mes retakes/rejets : ce qui me demande une action immédiate.
    prisma.task.count({ where: myRetakesWhere(user) }),
    // Ce qu'on attend de MOI : les reviews qui m'ont été confiées et qui n'ont pas encore
    // reçu de décision (et non, comme avant, les verdicts attendus de tout le studio).
    prisma.mediaObject.count({ where: awaitingMyReviewWhere(user) }),
    // Projets récents (miroir du tri de GET /api/projects) — la progression est calculée après.
    prisma.project.findMany({
      where: access,
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { id: true, name: true, thumbnailKey: true },
    }),
  ]);

  // Progression + compteurs par média : deux agrégats, plus aucune requête par ligne.
  const [progress, commentCounts] = await Promise.all([
    taskCountsByProject(recentProjectRows.map((p) => p.id)),
    prisma.comment.groupBy({
      by: ['mediaObjectId'],
      // Le compte affiché suit le même périmètre que ce que le lecteur peut ouvrir :
      // annoncer « 12 notes » à un client qui n'en verra que 3 serait faux.
      where: {
        mediaObjectId: { in: lastComments.map((c) => c.media.id) },
        ...(user.role === Role.CLIENT ? { isVisibleToClient: true } : {}),
      },
      _count: { _all: true },
    }),
  ]);

  // Même image que dans la liste des projets : la sienne, sinon celle du premier média
  // publié. L'accueil s'en tenait à la vignette choisie — un projet plein de travail livré
  // y restait au nom, alors que sa carte portait une image deux écrans plus loin.
  const projectFallbacks = await firstMediaThumbKeysForProjects(recentProjectRows.map((p) => p.id));
  const recentProjects = await Promise.all(
    recentProjectRows.map(async (p) => {
      const counts = progress.get(p.id) ?? { total: 0, done: 0 };
      return {
        id: p.id,
        name: p.name,
        thumbnailUrl: await effectiveThumbnailUrl(p.thumbnailKey, projectFallbacks.get(p.id) ?? null),
        totalTasks: counts.total,
        approvedTasks: counts.done,
      };
    }),
  );

  const countByMedia = new Map(commentCounts.map((g) => [g.mediaObjectId, g._count._all]));

  const latestReviews = await Promise.all(
    lastComments.map(async (c) => ({
      mediaId: c.media.id,
      kind: c.media.kind,
      name: c.media.originalName,
      thumbnailUrl: c.media.thumbnailKey ? await storage.getPresignedGetUrl(c.media.thumbnailKey) : null,
      location: loc(c.media.version?.task ?? null) || (c.media.version?.asset?.name ?? ''),
      versionName: c.media.version?.name ?? '',
      commentCount: countByMedia.get(c.media.id) ?? 0,
      lastComment: {
        content: c.content,
        author: c.author?.name ?? c.guestName ?? null,
        timestamp: c.timestamp,
        createdAt: c.createdAt,
      },
    })),
  );

  const activity = [
    ...versions.map((v) => ({
      type: 'version' as const,
      at: v.createdAt,
      label: `${v.name}${v.task ? ' — ' + v.task.name : ''}`,
      location: loc(v.task) || (v.asset?.name ?? ''),
      author: v.author?.name ?? null,
      taskId: v.task?.id ?? null,
      mediaId: null as number | null,
    })),
    ...media.map((m) => ({
      type: 'media' as const,
      at: m.createdAt,
      label: m.originalName,
      location: loc(m.version?.task ?? null) || (m.version?.asset?.name ?? ''),
      author: m.uploader?.name ?? null,
      taskId: m.version?.task?.id ?? null,
      mediaId: m.id,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 15);

  // Ce qui demande une action d'abord (miroir du front) : la famille de statut décide du
  // bloc, l'enum départage à l'intérieur — RETAKE reste devant REJECTED.
  const tasks = myTasks
    .sort((a, b) => taskPriority(a.status, a.pipelineStatus) - taskPriority(b.status, b.pipelineStatus))
    .slice(0, 8)
    .map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      status: t.status,
      location: loc(t),
      projectId: t.shot?.projectId ?? t.asset?.projectId ?? null,
      dueDate: t.dueDate,
    }));

  return {
    latestReviews,
    activity,
    myTasks: tasks,
    recentProjects,
    stats: {
      projects: projectCount,
      mediaInReview,
      comments: commentCount,
      mediaInReview7d,
      comments7d: commentCount7d,
      myRetakes,
      awaitingMyReview,
    },
  };
}
