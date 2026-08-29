// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MediaObject, PrismaClient } from '@prisma/client';
import type { PlannedComment } from '../generate';
import type { SeededProject, SeededVersion } from './project';
import type { SeededStudio } from './studio';

/**
 * Fils de review : commentaires ancrés, annotations, réponses, réactions, décisions.
 *
 * C'est ce qui distingue un jeu de données d'une maquette. Un commentaire de review porte
 * une frame, un dessin, un état, parfois un destinataire et une tâche née du retour — et il
 * a une date, forcément antérieure à celle de la version suivante. Rien de tout cela ne
 * s'obtient en postant des commentaires par l'API aujourd'hui.
 */

/** Média sur lequel s'ancrent les retours : le premier livrable regardable de la version. */
function anchorMedia(media: MediaObject[]): MediaObject | null {
  return media.find((m) => m.kind === 'VIDEO') ?? media.find((m) => m.kind === 'IMAGE') ?? media[0] ?? null;
}

async function writeComment(
  prisma: PrismaClient,
  studio: SeededStudio,
  media: MediaObject,
  comment: PlannedComment,
  projectId: number,
  shotId?: number,
): Promise<void> {
  const authorId = studio.users.get(comment.authorKey)?.id ?? null;
  const existing = await prisma.comment.findFirst({
    where: { mediaObjectId: media.id, userId: authorId, content: comment.text, parentId: null },
  });
  if (existing) return;

  const resolved = comment.state === 'RESOLVED';
  const resolverKey = comment.replies.at(-1)?.authorKey ?? comment.authorKey;
  const created = await prisma.comment.create({
    data: {
      mediaObjectId: media.id,
      userId: authorId,
      content: comment.text,
      createdAt: comment.createdAt,
      ...(comment.timestamp !== undefined ? { timestamp: comment.timestamp } : {}),
      ...(comment.duration !== undefined ? { duration: comment.duration } : {}),
      ...(comment.annotation ? { annotation: comment.annotation } : {}),
      state: comment.state,
      isResolved: resolved,
      ...(resolved
        ? {
            resolvedById: studio.users.get(resolverKey)?.id ?? null,
            resolvedAt: new Date(comment.createdAt.getTime() + 7200000),
          }
        : {}),
      isVisibleToClient: comment.visibleToClient,
      ...(comment.assigneeKey ? { assigneeId: studio.users.get(comment.assigneeKey)?.id ?? null } : {}),
    },
  });

  for (const reply of comment.replies) {
    await prisma.comment.create({
      data: {
        mediaObjectId: media.id,
        parentId: created.id,
        userId: studio.users.get(reply.authorKey)?.id ?? null,
        content: reply.text,
        createdAt: reply.createdAt,
        state: 'OPEN',
      },
    });
  }

  for (const reaction of comment.reactions) {
    const userId = studio.users.get(reaction.authorKey)?.id;
    if (!userId) continue;
    await prisma.reaction.upsert({
      where: { commentId_userId_emoji: { commentId: created.id, userId, emoji: reaction.emoji } },
      update: {},
      create: { commentId: created.id, userId, emoji: reaction.emoji },
    });
  }

  // Une tâche née d'un retour garde le lien vers son commentaire : c'est ce qui permet de
  // revenir à la frame commentée depuis le kanban.
  if (comment.spawnTask && shotId) {
    const departmentId = studio.departments.get(comment.spawnTask.dept) ?? null;
    const existingTask = await prisma.task.findFirst({
      where: { shotId, departmentId, name: comment.spawnTask.name },
    });
    if (!existingTask) {
      const status = await prisma.pipelineStatus.findFirst({
        where: { projectId, scope: 'task', code: 'ip' },
      });
      await prisma.task.create({
        data: {
          shotId,
          name: comment.spawnTask.name,
          type: 'OTHER',
          department: comment.spawnTask.dept,
          departmentId,
          assigneeId: studio.users.get(comment.spawnTask.assigneeKey)?.id ?? null,
          sourceCommentId: created.id,
          status: 'IN_PROGRESS',
          pipelineStatusId: status?.id ?? null,
          createdAt: new Date(comment.createdAt.getTime() + 1800000),
          order: 90,
        },
      });
    }
  }
}

/** Décision de review posée sur une version, et statut courant dénormalisé. */
async function writeDecision(
  prisma: PrismaClient,
  studio: SeededStudio,
  entry: SeededVersion,
): Promise<void> {
  const decision = entry.planned.decision;
  if (!decision) return;
  const statusId = studio.reviewStatuses.get(decision.status);
  if (!statusId) return;
  const existing = await prisma.reviewDecision.findFirst({
    where: { versionId: entry.version.id, statusId },
  });
  if (!existing) {
    await prisma.reviewDecision.create({
      data: {
        versionId: entry.version.id,
        statusId,
        comment: decision.note,
        authorId: studio.users.get(decision.byKey)?.id ?? null,
        createdAt: decision.at,
      },
    });
  }
  await prisma.version.update({ where: { id: entry.version.id }, data: { reviewStatusId: statusId } });
}

export interface ReviewSeedResult {
  comments: number;
  decisions: number;
  markers: number;
}

export async function seedReview(
  prisma: PrismaClient,
  studio: SeededStudio,
  seeded: SeededProject,
  mediaByVersion: Map<number, MediaObject[]>,
): Promise<ReviewSeedResult> {
  let comments = 0;
  let decisions = 0;
  let markers = 0;

  for (const entry of seeded.versions) {
    const media = mediaByVersion.get(entry.version.id) ?? [];
    await writeDecision(prisma, studio, entry);
    decisions += entry.planned.decision ? 1 : 0;

    const anchor = anchorMedia(media);
    if (!anchor) continue;

    for (const comment of entry.planned.comments) {
      await writeComment(prisma, studio, anchor, comment, seeded.project.id, entry.shot?.id);
      comments += 1;
    }

    for (const marker of entry.planned.markers) {
      const authorId = studio.users.get(marker.byKey)?.id ?? null;
      const existing = await prisma.timelineMarker.findFirst({
        where: { mediaObjectId: anchor.id, name: marker.name },
      });
      if (existing) continue;
      await prisma.timelineMarker.create({
        data: {
          mediaObjectId: anchor.id,
          frame: marker.frame,
          name: marker.name,
          color: marker.color,
          authorId,
          createdAt: entry.planned.createdAt,
        },
      });
      markers += 1;
    }
  }

  return { comments, decisions, markers };
}
