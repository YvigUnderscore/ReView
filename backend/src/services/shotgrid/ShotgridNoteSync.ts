// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '../../lib/prisma';
import { annotationToSvg } from '../../lib/annotationSvg';
import { escapeHtml } from '../../lib/html';
import { mediaSourceKey } from '../MediaService';
import { logger } from '../../lib/logger';
import { env } from '../../config/env';
import { storage } from '../StorageService';
import { belongsToProject, projectFilter } from './shotgridProjectGuard';
import { asDate, asEntityRef, asString, type SgRecord } from './shotgridMapper';
import { findByLocal, mapSgToLocal, upsertLink } from './shotgridLinks';
import { can } from './shotgridSettings';
import { importNoteAttachments } from './ShotgridNoteAttachments';
import { confirmGone, touch, type PullContext } from './ShotgridPullService';
import type { ShotgridWriter } from './ShotgridWriter';

/**
 * ShotGrid notes <-> ReView comments.
 *
 * The two tools carry the same conversation seen from two places: a supervision note written in ShotGrid must be readable during the review, and a
 * feedback posted on a frame must exist in the production registry. Each message keeps the mark of its origin: without it, nobody knows where to reply.
 */

const NOTE_FIELDS = [
  'subject',
  'content',
  'note_links',
  'tasks',
  'user',
    // Without this field, the API does not return the attachments and the supervisor's annotated image never reaches the review: the feedback arrives
    // stripped of its subject.
  'attachments',
  'created_at',
  'updated_at',
  'project',
];

/** Origin marker, readable by humans as well as by the synchronization. */
const FROM_REVIEW = '[ReView]';

export function isFromReview(content: string | null | undefined): boolean {
  return typeof content === 'string' && content.includes(FROM_REVIEW);
}

export interface NotePullOptions {
    /**
     * Precise notes to re-read (processing an event). The project filter stays in place: an identifier received by webhook proves nothing about its membership.
     */
  onlySgIds?: number[];
}

/**
 * Imports notes as comments.
 *
 * A ShotGrid note points to one or several entities (`note_links`): we only keep those attached to a Version already known to ReView, the only place where a
 * comment makes sense here. Notes created by ReView are ignored: they would come back as a duplicate of their own comment.
 */
export async function pullNotes(ctx: PullContext, options: NotePullOptions = {}): Promise<void> {
  if (!can(ctx.settings, 'notes', 'read')) return;

    // The project filter always comes first and is never replaced by the restriction on identifiers: the two add up, and each record received
    // then goes through `belongsToProject` again.
  const filters: Array<[string, string, unknown]> = [projectFilter(ctx.scope.sgProjectId)];
  if (options.onlySgIds?.length) filters.push(['id', 'in', options.onlySgIds]);

  const records = await ctx.client.search('Note', {
    fields: NOTE_FIELDS,
    filters,
    sort: '-id',
    maxRecords: options.onlySgIds?.length ?? 500,
  });

  const versionLinks = await mapSgToLocal(ctx.connection.id, 'version');
  const commentLinks = await mapSgToLocal(ctx.connection.id, 'comment');

    /**
     * Notes deleted on the site: **flagged, not applied**.
     *
     * A ReView comment has no trash: the table has no `deletedAt`. Honouring the removal would therefore erase for good a review feedback, its replies and
     * its annotation, on the strength of a clean-up done in ShotGrid. The rest of the integration moves to the trash and never deletes; we do not do the
     * opposite here in silence.
     *
     * The journal therefore says so, and a human decides. Without this line, the removal event left no trace at all, and the gap between the two tools stayed invisible.
     */
  if (options.onlySgIds?.length) {
    const alive = new Set(records.map((r) => r.id));
    for (const sgId of await confirmGone(ctx, 'Note', options.onlySgIds, alive)) {
      const link = commentLinks.get(sgId);
      if (!link) continue;
      ctx.journal.count('notes', 'skipped');
      await ctx.journal.log(
        'warn',
        'shotgrid.log.noteRetiredRemotely',
        { sgId },
        { sgType: 'Note', sgId, localType: 'comment', localId: link.localId },
      );
    }
  }

  for (const record of records) {
    if (!belongsToProject(record, ctx.scope).ok) {
      ctx.journal.count('guard', 'skipped');
      continue;
    }
    const content = asString(record.content) ?? asString(record.subject);
    if (!content || isFromReview(content)) continue;

    const known = commentLinks.get(record.id);
    if (known) {
            // Note already imported. We still go back for its attachments as long as we have not: notes received before this path existed never
            // got their annotated image, and nothing else would come and fetch it.
      if (!linkSaysAttachmentsDone(known.data)) await catchUpNote(ctx, record, known.localId);
      continue;
    }

    const versionRef = asEntityRefs(record.note_links).find((r) => r.type === 'Version');
    const localVersionId = versionRef ? versionLinks.get(versionRef.id)?.localId : undefined;
    if (!localVersionId) {
      ctx.journal.count('notes', 'skipped');
      continue;
    }

        // The comment is placed on the version's media: that is what the review displays.
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
                // Who wrote, when the person has no account here. This is the ordinary case: matching is done on the e-mail, and a studio has no reason to
                // have the same addresses on both sides. Without this field, the API could only offer an absent author, which the interface displays as "deleted account",
                // which is both wrong and hurtful to the person who made the remark.
        guestName: authorRef?.name ?? null,
                // The provenance is carried by the content: it survives export, copy and reading by someone who does not know the integration.
        content: `<p><em>ShotGrid</em></p>${
          subject ? `<p><strong>${escapeLines(subject)}</strong></p>` : ''
        }<p>${escapeLines(content)}</p>`,
        createdAt: asDate(record.created_at) ?? new Date(),
      },
    });

    const attachments = await importNoteAttachments(ctx, record, created.id);

    await upsertLink({
      connectionId: ctx.connection.id,
      localType: 'comment',
      localId: created.id,
      sgType: 'Note',
      sgId: record.id,
      sgUpdatedAt: asDate(record.updated_at),
      data: { fromShotgrid: true, attachmentsImported: true, attachmentCount: attachments },
    });
    touch(ctx, 'comment', created.id);
    ctx.journal.count('notes', 'created');
  }
}

/** Does the link bear the trace of a pass over the attachments? */
function linkSaysAttachmentsDone(data: unknown): boolean {
  return Boolean(data && typeof data === 'object' && 'attachmentsImported' in data);
}

/**
 * Catch-up for a note imported before this path existed.
 *
 * Two gaps to repair: the attachment, never fetched, and the author's name, left in the prose instead of the intended field, which made "deleted account" display
 * instead of a very real person. The comment may have been deleted since: we then still mark the link, so as not to come back to it at every synchronization.
 */
async function catchUpNote(ctx: PullContext, record: SgRecord, commentId: number): Promise<void> {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, guestName: true, userId: true, content: true },
  });
  const count = comment ? await importNoteAttachments(ctx, record, commentId) : 0;

  const authorName = asEntityRef(record.user)?.name ?? null;
  if (comment && !comment.userId && !comment.guestName && authorName) {
    await prisma.comment.update({
      where: { id: commentId },
      data: {
        guestName: authorName,
                // The name stops being written twice: once as the author, once in the text. This prefix is of our making, not someone's prose: normalizing it
                // rewrites no one's remarks.
        content: comment.content.replace(/^<p><em>ShotGrid[^<]*<\/em><\/p>/, '<p><em>ShotGrid</em></p>'),
      },
    });
  }

  await upsertLink({
    connectionId: ctx.connection.id,
    localType: 'comment',
    localId: commentId,
    sgType: 'Note',
    sgId: record.id,
    sgUpdatedAt: asDate(record.updated_at),
    data: { fromShotgrid: true, attachmentsImported: true, attachmentCount: count },
  });
  if (count > 0 || authorName) {
    touch(ctx, 'comment', commentId);
    ctx.journal.count('notes', 'updated');
  }
}

export interface PushNoteContext {
  connectionId: number;
  sgProjectId: number;
    /** Every write goes through here: the linked project is set by the writer, not here. */
  writer: Pick<ShotgridWriter, 'create' | 'upload'>;
  attachAnnotations: boolean;
  asUserLogin: string | null;
}

/**
 * Sends a ReView comment as a ShotGrid note.
 *
 * The text carries the time reference: a remark on a precise frame loses all its meaning if the reader does not know which one. The annotated image goes
 * as an attachment when it exists: it carries the essentials of the point.
 */
export async function pushComment(ctx: PushNoteContext, commentId: number): Promise<number | null> {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    include: {
      author: { select: { name: true, email: true } },
      media: { select: { id: true, versionId: true, metadata: true, storageKey: true, mimeType: true } },
    },
  });
  if (!comment) return null;

  const versionLink = await findByLocal(ctx.connectionId, 'version', comment.media.versionId);
  if (!versionLink) return null;

    // A comment already carried by a note must not generate a second one: a synchronization retry, a catch-up or a simple double click would
    // otherwise pass through here twice.
  const existing = await findByLocal(ctx.connectionId, 'comment', comment.id);
  if (existing) {
    logger.debug({ commentId, sgNoteId: existing.sgId }, 'Commentaire déjà présent en note ShotGrid');
    return existing.sgId;
  }

  const author = comment.author?.name ?? comment.author?.email ?? 'ReView';
    // Version name: when attaching is not possible, it is what places the feedback.
  const versionName = (
    await prisma.version.findUnique({
      where: { id: comment.media.versionId },
      select: { name: true },
    })
  )?.name;
    // Time reference: the frame when the media's rate makes it computable, the timestamp otherwise. A remark without a reference is unusable in review.
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

    /**
     * Attaching to the version is attempted, not required.
     *
     * Some sites refuse to write `note_links`: a permissions restriction, or a schema specific to the studio. Losing the feedback because of it would be absurd:
     * we fall back on a free note whose subject and body carry the context, and the return link to ReView stays clickable.
     */
    // No `project` here: it is `ShotgridWriter` that sets it, and it alone.
  const base = {
    subject: timecode ? `ReView — ${timecode}` : 'ReView',
    content: body,
  };
  let created: SgRecord;
  try {
    created = await ctx.writer.create(
      'Note',
      { ...base, note_links: [{ type: 'Version', id: versionLink.sgId }] },
      { asUserLogin: ctx.asUserLogin },
    );
  } catch (err) {
    logger.info(
      { commentId, sgVersionId: versionLink.sgId, err: err instanceof Error ? err.message : err },
      'Rattachement de note refusé par le site — note créée sans lien',
    );
    created = await ctx.writer.create(
      'Note',
      { ...base, subject: `${base.subject} — ${versionName ?? `Version #${versionLink.sgId}`}` },
      { asUserLogin: ctx.asUserLogin },
    );
  }

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
 * Attachment: the frame with the drawing burned in.
 *
 * The annotation is stored as normalized geometry, not as an image: sent as is, it would show nothing. The frame is therefore extracted from the media and composed
 * on the fly, at each send.
 *
 * This path had a second one, with priority: an already computed capture, read from `Comment.screenshotKey`. Nobody in the repository ever wrote this column:
 * the fallback was therefore the only real path, and the read gave the illusion of an optimization. The column and its branch left together
 * (migration `20260908090000_shotgrid_liens_fiables`).
 */
async function attachAnnotationImage(
  ctx: PushNoteContext,
  sgNoteId: number,
  comment: {
    id: number;
    annotation: unknown;
    timestamp: number | null;
    media: { id: number; storageKey: string; mimeType: string; metadata: unknown };
  },
): Promise<void> {
  try {
    const buffer = await renderAnnotatedFrame(comment);
    if (!buffer) return;
    await ctx.writer.upload(
      'Note',
      sgNoteId,
      'attachments',
      buffer,
      `review-annotation-${comment.id}.png`,
      'image/png',
    );
    logger.info({ commentId: comment.id, sgNoteId }, 'Frame annotée jointe à la note ShotGrid');
  } catch (err) {
    logger.warn({ err, commentId: comment.id }, 'Annotation non jointe à la note ShotGrid');
  }
}

/** Readable time reference: frame number if the rate is known, otherwise m:ss. */
export function frameLabel(timestamp: number | null, fps: number | null): string | null {
  if (typeof timestamp !== 'number') return null;
  if (fps && fps > 0) return `frame ${Math.round(timestamp * fps)}`;
  const total = Math.floor(timestamp);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Rate of the media, as the pipeline recorded it at processing. */
export function mediaFrameRate(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = (metadata as Record<string, unknown>).frameRate ?? (metadata as Record<string, unknown>).fps;
  const value = typeof raw === 'string' ? Number.parseFloat(raw) : raw;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Plain text of a rich content: ShotGrid does not display HTML in its notes. */
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

/**
 * Plain text of a ShotGrid note -> comment HTML: the escaping is that of `lib/html` (six characters, quotes included), line breaks become `<br>`.
 * The local copy that lived here escaped neither `"` nor `'`.
 */
function escapeLines(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function asEntityRefs(value: unknown): Array<{ id: number; type: string; name?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => asEntityRef(v))
    .filter((r): r is { id: number; type: string; name?: string } => r !== null);
}

/**
 * Composes the commented frame and its annotation into a single image.
 *
 * ffmpeg does both operations: extract the instant from the media, then burn in the rendered SVG of the annotation. Going through the SVG avoids adding a
 * drawing library, and gives exactly the geometry the artist traced on screen.
 */
async function renderAnnotatedFrame(comment: {
  annotation: unknown;
  timestamp: number | null;
  media: { storageKey: string; mimeType: string; metadata: unknown };
}): Promise<Buffer | null> {
  const meta = (comment.media.metadata ?? {}) as { width?: number; height?: number };
  const width = typeof meta.width === 'number' && meta.width > 0 ? meta.width : 1920;
  const height = typeof meta.height === 'number' && meta.height > 0 ? meta.height : 1080;
  const svg = annotationToSvg(comment.annotation, width, height);
  if (!svg) return null;

  const dir = await mkdtemp(join(tmpdir(), 'sg-annot-'));
  try {
    const source = join(dir, 'source');
    const overlay = join(dir, 'overlay.svg');
    const output = join(dir, 'out.png');
        // After transcoding, the original is deleted and the proxy is authoritative: `mediaSourceKey` designates the file actually served.
    await storage.downloadToFile(mediaSourceKey(comment.media), source);
    await writeFile(overlay, svg, 'utf8');

    const seek = comment.timestamp && comment.timestamp > 0 ? ['-ss', String(comment.timestamp)] : [];
    await runFfmpeg([
      ...seek,
      '-i',
      source,
      '-i',
      overlay,
      '-filter_complex',
      `[0:v]scale=${width}:${height}[bg];[bg][1:v]overlay=0:0`,
      '-frames:v',
      '1',
      '-y',
      output,
    ]);
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args]);
    let stderr = '';
    proc.stderr.on('data', (chunk) => (stderr += String(chunk)));
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg (${code}) : ${stderr.slice(0, 200)}`)),
    );
  });
}
