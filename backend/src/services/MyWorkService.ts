// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { paginate, pageArgs, type Paginated, type PaginationParams } from '../lib/pagination';
import { commentFeedWhere, myOpenTasksWhere, myRetakesWhere, type SessionUser } from '../lib/homeScope';

/**
 * Les vues transverses de « ce qui m'attend » : mes tâches et les derniers commentaires
 * de mon périmètre.
 *
 * Elles existent parce que les compteurs de l'Accueil ne menaient nulle part. Deux cartes
 * pointaient une ancre (`#my-tasks`) qui disparaissait avec le bloc « mes tâches » dès
 * qu'on le retirait de son accueil — le clic ne faisait alors rien — et la carte des
 * commentaires ouvrait une page qui n'en montre aucun. Un chiffre qu'on ne peut pas
 * déplier n'est pas vérifiable : il faut pouvoir en voir les lignes.
 *
 * Chaque liste lit le périmètre du compteur qui l'ouvre (`lib/homeScope`), jamais une
 * copie : c'est ce qui garantit que la page montre autant de lignes que la carte annonce.
 */

/** Ce que la liste sert à un appelant qui veut agir sur ses tâches. */
export interface MyTaskRow {
  id: number;
  name: string;
  type: string;
  status: string;
  location: string;
  projectId: number | null;
  projectName: string | null;
  dueDate: Date | null;
}

/** Une note du fil : de quoi la lire et l'ouvrir au bon endroit du média. */
export interface CommentFeedRow {
  id: number;
  mediaId: number;
  mediaKind: string;
  mediaName: string;
  location: string;
  versionName: string;
  content: string;
  timestamp: number | null;
  createdAt: Date;
  author: string | null;
}

/** Localisation lisible (SQ010 · SH020, ou nom d'asset) — même forme qu'à l'Accueil. */
function place(
  holder: {
    shot?: { code: string; sequence?: { code: string } | null } | null;
    asset?: { name: string } | null;
  } | null,
): string {
  if (!holder) return '';
  if (holder.shot) {
    return `${holder.shot.sequence ? holder.shot.sequence.code + ' · ' : ''}${holder.shot.code}`;
  }
  return holder.asset?.name ?? '';
}

/**
 * Mes tâches, tous projets confondus.
 *
 * `scope` dit laquelle des deux cartes personnelles a été cliquée : tout ce qui m'est
 * assigné et vivant, ou seulement ce qui m'est revenu (retake, rejet). Le tri place
 * l'échéance la plus proche d'abord et les tâches sans date à la fin — un `id` départage,
 * sans quoi deux tâches sans échéance pourraient changer de page d'une requête à l'autre.
 */
export async function listMyTasks(
  user: SessionUser,
  scope: 'all' | 'blocked',
  p: PaginationParams,
): Promise<Paginated<MyTaskRow>> {
  const where = scope === 'blocked' ? myRetakesWhere(user) : myOpenTasksWhere(user);
  const parent = { select: { name: true } };
  const [rows, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'desc' }],
      ...pageArgs(p),
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        dueDate: true,
        shot: {
          select: { projectId: true, code: true, sequence: { select: { code: true } }, project: parent },
        },
        asset: { select: { projectId: true, name: true, project: parent } },
      },
    }),
    prisma.task.count({ where }),
  ]);
  const items = rows.map((t) => ({
    id: t.id,
    name: t.name,
    type: t.type,
    status: t.status,
    location: place(t),
    projectId: t.shot?.projectId ?? t.asset?.projectId ?? null,
    projectName: t.shot?.project.name ?? t.asset?.project.name ?? null,
    dueDate: t.dueDate,
  }));
  return paginate(items, total, p);
}

/**
 * Les derniers commentaires de mon périmètre, du plus récent au plus ancien.
 *
 * Le fil rend un commentaire par ligne — et non un média par ligne comme « dernières
 * reviews » : c'est le chiffre de la carte « commentaires » qu'il déplie. Les colonnes
 * lourdes (tracé d'annotation, viewpoint 3D, pièces jointes) restent en base : rien de ce
 * qui ne s'affiche pas ne traverse le réseau.
 */
export async function listMyComments(
  user: SessionUser,
  p: PaginationParams,
): Promise<Paginated<CommentFeedRow>> {
  const where = commentFeedWhere(user);
  const [rows, total] = await Promise.all([
    prisma.comment.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...pageArgs(p),
      select: {
        id: true,
        content: true,
        timestamp: true,
        createdAt: true,
        guestName: true,
        author: { select: { name: true } },
        media: {
          select: {
            id: true,
            kind: true,
            originalName: true,
            version: {
              select: {
                name: true,
                task: {
                  select: {
                    shot: { select: { code: true, sequence: { select: { code: true } } } },
                    asset: { select: { name: true } },
                  },
                },
                asset: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
    prisma.comment.count({ where }),
  ]);
  const items = rows.map((c) => ({
    id: c.id,
    mediaId: c.media.id,
    mediaKind: c.media.kind,
    mediaName: c.media.originalName,
    location: place(c.media.version?.task ?? null) || (c.media.version?.asset?.name ?? ''),
    versionName: c.media.version?.name ?? '',
    content: c.content,
    timestamp: c.timestamp,
    createdAt: c.createdAt,
    author: c.author?.name ?? c.guestName ?? null,
  }));
  return paginate(items, total, p);
}
