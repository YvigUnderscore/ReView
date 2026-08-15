// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { env } from '../../config/env';
import { storage } from '../StorageService';
import { belongsToProject, projectFilter } from './shotgridProjectGuard';
import { asDate, asEntityRef, asString, type SgRecord } from './shotgridMapper';
import { findByLocal, mapSgToLocal, upsertLink } from './shotgridLinks';
import { can } from './shotgridSettings';
import type { PullContext } from './ShotgridPullService';

/**
 * Notes ShotGrid ↔ commentaires ReView.
 *
 * Les deux outils portent la même conversation vue de deux endroits : une note de
 * supervision écrite dans ShotGrid doit se lire pendant la review, et un retour posé
 * sur une frame doit exister dans le registre de production. Chaque message garde la
 * marque de sa provenance — sans elle, personne ne sait où répondre.
 */

const NOTE_FIELDS = [
  'subject',
  'content',
  'note_links',
  'tasks',
  'user',
  'created_at',
  'updated_at',
  'project',
];

/** Marqueur d'origine, lisible par l'humain comme par la synchronisation. */
const FROM_REVIEW = '[ReView]';

export function isFromReview(content: string | null | undefined): boolean {
  return typeof content === 'string' && content.includes(FROM_REVIEW);
}

/**
 * Import des notes en commentaires.
 *
 * Une note ShotGrid pointe une ou plusieurs entités (`note_links`) : on ne retient que
 * celles rattachées à une Version déjà connue de ReView, seul endroit où un commentaire
 * a un sens ici. Les notes créées par ReView sont ignorées — elles reviendraient en
 * double de leur propre commentaire.
 */
export async function pullNotes(ctx: PullContext): Promise<void> {
  if (!can(ctx.settings, 'notes', 'read')) return;

  const records = await ctx.client.search('Note', {
    fields: NOTE_FIELDS,
    filters: [projectFilter(ctx.scope.sgProjectId)],
    sort: '-id',
    maxRecords: 500,
  });

  const versionLinks = await mapSgToLocal(ctx.connection.id, 'version');
  const commentLinks = await mapSgToLocal(ctx.connection.id, 'comment');

  for (const record of records) {
    if (!belongsToProject(record, ctx.scope).ok) {
      ctx.journal.count('guard', 'skipped');
      continue;
    }
    const content = asString(record.content) ?? asString(record.subject);
    if (!content || isFromReview(content)) continue;
    if (commentLinks.has(record.id)) continue; // déjà importée

    const versionRef = asEntityRefs(record.note_links).find((r) => r.type === 'Version');
    const localVersionId = versionRef ? versionLinks.get(versionRef.id)?.localId : undefined;
    if (!localVersionId) {
      ctx.journal.count('notes', 'skipped');
      continue;
    }

    // Le commentaire se pose sur le média de la version : c'est lui que la review affiche.
    const media = await prisma.mediaObject.findFirst({
      where: { versionId: localVersionId, deletedAt: null },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    if (!media) {
      ctx.journal.count('notes', 'skipped');
      continue;
    }

    const authorRef = asEntityRef(record.user);
    const authorLink = authorRef
      ? await prisma.shotgridLink.findUnique({
          where: {
            connectionId_sgType_sgId: {
              connectionId: ctx.connection.id,
              sgType: 'HumanUser',
              sgId: authorRef.id,
            },
          },
        })
      : null;

    const subject = asString(record.subject);
    const created = await prisma.comment.create({
      data: {
        mediaObjectId: media.id,
        userId: authorLink?.localId ?? null,
        // La provenance est portée par le contenu : elle survit à l'export, au copier
        // et à la lecture par quelqu'un qui ne connaît pas l'intégration.
        content: `<p><em>ShotGrid${authorRef?.name ? ` — ${authorRef.name}` : ''}</em></p>${
          subject ? `<p><strong>${escapeHtml(subject)}</strong></p>` : ''
        }<p>${escapeHtml(content)}</p>`,
        createdAt: asDate(record.created_at) ?? new Date(),
      },
    });

    await upsertLink({
      connectionId: ctx.connection.id,
      localType: 'comment',
      localId: created.id,
      sgType: 'Note',
      sgId: record.id,
      sgUpdatedAt: asDate(record.updated_at),
      data: { fromShotgrid: true },
    });
    ctx.journal.count('notes', 'created');
  }
}

export interface PushNoteContext {
  connectionId: number;
  sgProjectId: number;
  client: {
    createAs: (entity: string, data: Record<string, unknown>, asUser?: string | null) => Promise<SgRecord>;
    uploadFile: (
      entity: string,
      id: number,
      field: string,
      body: Buffer,
      filename: string,
      contentType?: string,
    ) => Promise<void>;
  };
  attachAnnotations: boolean;
  asUserLogin: string | null;
}

/**
 * Envoi d'un commentaire ReView en note ShotGrid.
 *
 * Le texte reprend le repère de temps : une remarque sur une frame précise perd tout
 * son sens si le lecteur ne sait pas laquelle. L'image annotée part en pièce jointe
 * quand elle existe — c'est elle qui porte l'essentiel du propos.
 */
export async function pushComment(ctx: PushNoteContext, commentId: number): Promise<number | null> {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    include: {
      author: { select: { name: true, email: true } },
      media: { select: { id: true, versionId: true, metadata: true } },
    },
  });
  if (!comment) return null;

  const versionLink = await findByLocal(ctx.connectionId, 'version', comment.media.versionId);
  if (!versionLink) return null;

  const author = comment.author?.name ?? comment.author?.email ?? 'ReView';
  // Repère de temps : la frame quand la cadence du média permet de la calculer,
  // l'horodatage sinon. Une remarque sans repère est inexploitable en review.
  const fps = mediaFrameRate(comment.media.metadata);
  const timecode = frameLabel(comment.timestamp, fps);
  const reviewUrl = env.APP_URL
    ? `${env.APP_URL.replace(/\/$/, '')}/review/${comment.media.id}?comment=${comment.id}`
    : null;

  const body = [
    stripHtml(comment.content),
    '',
    timecode ? `— ${timecode}` : null,
    `${FROM_REVIEW} ${author}`,
    reviewUrl,
  ]
    .filter((line) => line !== null)
    .join('\n');

  const created = await ctx.client.createAs(
    'Note',
    {
      project: { type: 'Project', id: ctx.sgProjectId },
      subject: timecode ? `ReView — ${timecode}` : 'ReView',
      content: body,
      note_links: [{ type: 'Version', id: versionLink.sgId }],
    },
    ctx.asUserLogin,
  );

  await upsertLink({
    connectionId: ctx.connectionId,
    localType: 'comment',
    localId: comment.id,
    sgType: 'Note',
    sgId: created.id,
    data: { pushedFromReview: true },
  });

  if (ctx.attachAnnotations) await attachAnnotationImage(ctx, created.id, comment);
  logger.info({ commentId, sgNoteId: created.id }, 'Commentaire poussé en note ShotGrid');
  return created.id;
}

/**
 * Pièce jointe : l'image de l'annotation telle qu'elle a été dessinée.
 * Sans elle, la note décrit un tracé que personne ne peut voir.
 */
async function attachAnnotationImage(
  ctx: PushNoteContext,
  sgNoteId: number,
  comment: { id: number; screenshotKey: string | null },
): Promise<void> {
  // `screenshotKey` porte la capture de la frame AVEC le dessin incrusté : c'est elle
  // qui rend la remarque compréhensible sans ouvrir ReView.
  if (!comment.screenshotKey) return;
  try {
    const buffer = await storage.getObjectBuffer(comment.screenshotKey);
    await ctx.client.uploadFile(
      'Note',
      sgNoteId,
      'attachments',
      buffer,
      `review-annotation-${comment.id}.png`,
      'image/png',
    );
  } catch (err) {
    logger.warn({ err, commentId: comment.id }, 'Annotation non jointe à la note ShotGrid');
  }
}

/** Repère de temps lisible : numéro de frame si la cadence est connue, sinon m:ss. */
export function frameLabel(timestamp: number | null, fps: number | null): string | null {
  if (typeof timestamp !== 'number') return null;
  if (fps && fps > 0) return `frame ${Math.round(timestamp * fps)}`;
  const total = Math.floor(timestamp);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Cadence du média, telle que le pipeline l'a relevée au traitement. */
export function mediaFrameRate(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = (metadata as Record<string, unknown>).frameRate ?? (metadata as Record<string, unknown>).fps;
  const value = typeof raw === 'string' ? Number.parseFloat(raw) : raw;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Texte nu d'un contenu riche — ShotGrid n'affiche pas de HTML dans ses notes. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

function asEntityRefs(value: unknown): Array<{ id: number; type: string; name?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => asEntityRef(v))
    .filter((r): r is { id: number; type: string; name?: string } => r !== null);
}
