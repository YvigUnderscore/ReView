// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '../../lib/prisma';
import { annotationToSvg } from '../../lib/annotationSvg';
import { mediaSourceKey } from '../MediaService';
import { logger } from '../../lib/logger';
import { env } from '../../config/env';
import { storage } from '../StorageService';
import { belongsToProject, projectFilter } from './shotgridProjectGuard';
import { asDate, asEntityRef, asString, type SgRecord } from './shotgridMapper';
import { findByLocal, mapSgToLocal, upsertLink } from './shotgridLinks';
import { can } from './shotgridSettings';
import { importNoteAttachments } from './ShotgridNoteAttachments';
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
  // Sans ce champ, l'API ne renvoie pas les pièces jointes et l'image annotée du
  // superviseur n'atteint jamais la review — le retour arrive amputé de son sujet.
  'attachments',
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

    const known = commentLinks.get(record.id);
    if (known) {
      // Note déjà importée. On repasse tout de même chercher ses pièces jointes tant
      // qu'on ne l'a pas fait : les notes reçues avant que ce chemin existe n'ont jamais
      // eu leur image annotée, et rien d'autre ne viendrait la chercher.
      if (!linkSaysAttachmentsDone(known.data)) await catchUpNote(ctx, record, known.localId);
      continue;
    }

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
        // Qui a écrit, quand la personne n'a pas de compte ici. C'est le cas ordinaire :
        // le rapprochement se fait sur l'e-mail, et un studio n'a aucune raison d'avoir
        // les mêmes adresses des deux côtés. Sans ce champ, l'API ne pouvait proposer
        // qu'un auteur absent — que l'interface affiche « compte supprimé », ce qui est
        // à la fois faux et vexant pour la personne qui a fait la remarque.
        guestName: authorRef?.name ?? null,
        // La provenance est portée par le contenu : elle survit à l'export, au copier
        // et à la lecture par quelqu'un qui ne connaît pas l'intégration.
        content: `<p><em>ShotGrid</em></p>${
          subject ? `<p><strong>${escapeHtml(subject)}</strong></p>` : ''
        }<p>${escapeHtml(content)}</p>`,
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
    ctx.journal.count('notes', 'created');
  }
}

/** Le lien porte-t-il la trace d'un passage sur les pièces jointes ? */
function linkSaysAttachmentsDone(data: unknown): boolean {
  return Boolean(data && typeof data === 'object' && 'attachmentsImported' in data);
}

/**
 * Rattrapage d'une note importée avant que ce chemin existe.
 *
 * Deux manques à réparer : la pièce jointe, jamais rapatriée, et le nom de l'auteur, resté
 * dans la prose au lieu du champ prévu — ce qui faisait afficher « compte supprimé » à la
 * place d'une personne bien réelle. Le commentaire peut avoir été supprimé depuis : on
 * marque alors quand même le lien, pour ne pas y revenir à chaque synchronisation.
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
        // Le nom cesse d'être écrit deux fois : une fois comme auteur, une fois dans le
        // texte. Ce préfixe est de notre fabrication, pas la prose de quelqu'un — le
        // normaliser ne réécrit le propos de personne.
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
  if (count > 0 || authorName) ctx.journal.count('notes', 'updated');
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
      media: { select: { id: true, versionId: true, metadata: true, storageKey: true, mimeType: true } },
    },
  });
  if (!comment) return null;

  const versionLink = await findByLocal(ctx.connectionId, 'version', comment.media.versionId);
  if (!versionLink) return null;

  // Un commentaire déjà porté par une note ne doit pas en engendrer une seconde :
  // une reprise de synchronisation, un rattrapage ou un simple double clic passeraient
  // sinon deux fois par ici.
  const existing = await findByLocal(ctx.connectionId, 'comment', comment.id);
  if (existing) {
    logger.debug({ commentId, sgNoteId: existing.sgId }, 'Commentaire déjà présent en note ShotGrid');
    return existing.sgId;
  }

  const author = comment.author?.name ?? comment.author?.email ?? 'ReView';
  // Nom de la version : sans rattachement possible, c'est lui qui situe le retour.
  const versionName = (
    await prisma.version.findUnique({
      where: { id: comment.media.versionId },
      select: { name: true },
    })
  )?.name;
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

  /**
   * Le rattachement à la version est tenté, pas exigé.
   *
   * Certains sites refusent d'écrire `note_links` — restriction de permissions ou de
   * schéma propre au studio. Perdre le retour pour autant serait absurde : on retombe
   * sur une note libre dont le sujet et le corps portent le contexte, et le lien de
   * retour vers ReView reste cliquable.
   */
  const base = {
    project: { type: 'Project', id: ctx.sgProjectId },
    subject: timecode ? `ReView — ${timecode}` : 'ReView',
    content: body,
  };
  let created: SgRecord;
  try {
    created = await ctx.client.createAs(
      'Note',
      { ...base, note_links: [{ type: 'Version', id: versionLink.sgId }] },
      ctx.asUserLogin,
    );
  } catch (err) {
    logger.info(
      { commentId, sgVersionId: versionLink.sgId, err: err instanceof Error ? err.message : err },
      'Rattachement de note refusé par le site — note créée sans lien',
    );
    created = await ctx.client.createAs(
      'Note',
      { ...base, subject: `${base.subject} — ${versionName ?? `Version #${versionLink.sgId}`}` },
      ctx.asUserLogin,
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
 * Pièce jointe : la frame avec le dessin incrusté.
 *
 * L'annotation est stockée en géométrie normalisée, pas en image : envoyée telle
 * quelle, elle ne montrerait rien. On l'incruste donc sur la frame concernée. Une
 * capture déjà calculée (`screenshotKey`) est utilisée en priorité ; sinon la frame est
 * extraite du média et composée à la volée.
 */
async function attachAnnotationImage(
  ctx: PushNoteContext,
  sgNoteId: number,
  comment: {
    id: number;
    screenshotKey: string | null;
    annotation: unknown;
    timestamp: number | null;
    media: { id: number; storageKey: string; mimeType: string; metadata: unknown };
  },
): Promise<void> {
  try {
    const buffer = comment.screenshotKey
      ? await storage.getObjectBuffer(comment.screenshotKey)
      : await renderAnnotatedFrame(comment);
    if (!buffer) return;
    await ctx.client.uploadFile(
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

/**
 * Compose la frame commentée et son annotation en une image unique.
 *
 * ffmpeg fait les deux opérations : extraire l'instant du média, puis incruster le SVG
 * rendu de l'annotation. Passer par le SVG évite d'ajouter une bibliothèque de dessin —
 * et donne exactement la géométrie que l'artiste a tracée à l'écran.
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
    // Après transcodage, l'original est effacé et c'est le proxy qui fait foi :
    // `mediaSourceKey` désigne le fichier réellement servi.
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
