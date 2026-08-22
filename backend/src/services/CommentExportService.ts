// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { CommentState, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { htmlToText } from '../lib/mailText';
import {
  resolveProjectIdForMedia,
  resolveProjectIdForShot,
  resolveProjectIdForVersion,
} from '../lib/pipeline';
import { displayName } from '../lib/userView';
import { resolveProjectSettingsById } from '../lib/projectSettings';
import { resolveUserLocale } from '../lib/settings';
import { t } from '../i18n';
import { toNotesCsv, flattenNoteText, type NoteCsvRow } from '../lib/notesCsv';
import { toEdl, timecodeAt, type EdlClip, type EdlColor } from '../lib/notesEdl';
import { toOtio, type OtioClip, type OtioColor } from '../lib/notesOtio';
import { renderNotesSheet, type SheetNote } from '../lib/notesSheetHtml';
import { annotationToSvg } from '../lib/annotationSvg';
import { collectClips, type ClipContext } from './CommentExportScope';
import { createSheetImages, sheetLabels } from './CommentExportSheet';

/**
 * Sortie des notes de review hors de l'application (CSV, EDL, OTIO, planche imprimable).
 *
 * Le fil de review contient déjà tout ce qu'une salle de montage ou un tableur attend —
 * horodatage à la frame, auteur, état, décision, annotation — mais rien ne permettait de
 * l'en sortir. Chaque format vise un lecteur précis : le CSV pour la production, l'EDL et
 * l'OTIO pour le montage, la planche pour la relecture papier ou le client.
 *
 * L'accès projet est asserté PAR LA ROUTE, à partir de `resolveScopeProject` : ces
 * fonctions reçoivent une portée déjà autorisée (même contrat que `CommentService`).
 */

export type NotesScope = 'media' | 'version' | 'shot' | 'playlist' | 'timeline';
export type NotesFormat = 'csv' | 'edl' | 'otio' | 'sheet';

export interface ExportViewer {
  id: number;
  role: Role;
}

export interface ExportedFile {
  filename: string;
  contentType: string;
  body: string;
  /** Le plafond de notes a mordu : le fichier ne contient pas tout. */
  truncated: boolean;
}

/** Plafond de notes par export — au-delà, le fichier n'est plus lisible par personne. */
export const MAX_NOTES = 5000;

/** Plafond de la planche : chaque note y embarque une image, donc quelques dizaines de Ko. */
export const MAX_SHEET_NOTES = 200;

/** Un montage et une playlist se posent sur une timeline ; un média isolé, non. */
const EDITORIAL_SCOPES: ReadonlySet<NotesScope> = new Set<NotesScope>(['playlist', 'timeline']);

const CONTENT_TYPES: Record<NotesFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  edl: 'text/plain; charset=utf-8',
  otio: 'application/json; charset=utf-8',
  sheet: 'text/html; charset=utf-8',
};

const EXTENSIONS: Record<NotesFormat, string> = { csv: 'csv', edl: 'edl', otio: 'otio', sheet: 'html' };

/** Couleur de marqueur par état de note — la même des deux côtés (EDL et OTIO). */
const STATE_COLOR: Record<CommentState, EdlColor & OtioColor> = {
  [CommentState.OPEN]: 'RED',
  [CommentState.WIP]: 'YELLOW',
  [CommentState.QUESTION]: 'CYAN',
  [CommentState.WONT_FIX]: 'BLUE',
  [CommentState.RESOLVED]: 'GREEN',
};

const userSelect = {
  select: { id: true, name: true, email: true, firstName: true, lastName: true, username: true },
} as const;

/** Une note telle que l'export la manipule : texte à plat et identités déjà résolues. */
interface ExportNote {
  id: number;
  parentId: number | null;
  mediaObjectId: number;
  text: string;
  timestamp: number | null;
  duration: number | null;
  timelineTime: number | null;
  annotation: unknown;
  state: CommentState;
  isResolved: boolean;
  isVisibleToClient: boolean;
  createdAt: Date;
  author: string;
  resolvedBy: string;
  assignee: string;
}

/** Projet porteur d'une portée d'export — la route en fait l'assertion RBAC. */
export async function resolveScopeProject(scope: NotesScope, id: number): Promise<number | null> {
  if (scope === 'media') return resolveProjectIdForMedia(id);
  if (scope === 'version') return resolveProjectIdForVersion(id);
  if (scope === 'shot') return resolveProjectIdForShot(id);
  const row =
    scope === 'playlist'
      ? await prisma.playlist.findUnique({ where: { id }, select: { projectId: true } })
      : await prisma.timeline.findUnique({ where: { id }, select: { projectId: true } });
  return row?.projectId ?? null;
}

/** Notes de la portée, à plat, dans l'ordre des clips puis du fil. */
async function collectNotes(
  scope: NotesScope,
  scopeId: number,
  clips: ClipContext[],
  viewer: ExportViewer,
  limit: number,
): Promise<{ notes: ExportNote[]; truncated: boolean }> {
  const mediaIds = clips.map((c) => c.mediaId);
  if (mediaIds.length === 0) return { notes: [], truncated: false };
  const rows = await prisma.comment.findMany({
    where: {
      mediaObjectId: { in: mediaIds },
      // Un retour de montage reste au montage tant que personne ne l'a renvoyé sur la
      // review du plan : même règle que `CommentService.listThread`, sans quoi l'export
      // d'un shot déverserait des notes de coupe que l'artiste n'a jamais vues.
      ...(scope === 'timeline'
        ? { timelineId: scopeId }
        : { OR: [{ timelineId: null }, { sharedToShot: true }] }),
      // Un compte CLIENT ne lit que ce qui lui est destiné : un fichier téléchargé se
      // transmet, et la review interne n'a pas à voyager avec.
      ...(viewer.role === Role.CLIENT ? { isVisibleToClient: true } : {}),
    },
    orderBy: [{ mediaObjectId: 'asc' }, { createdAt: 'asc' }],
    take: limit + 1,
    include: { author: userSelect, resolvedBy: userSelect, assignee: userSelect },
  });
  const truncated = rows.length > limit;
  const notes = rows.slice(0, limit).map<ExportNote>((c) => ({
    id: c.id,
    parentId: c.parentId,
    mediaObjectId: c.mediaObjectId,
    text: htmlToText(c.content),
    timestamp: c.timestamp,
    duration: c.duration,
    timelineTime: c.timelineTime,
    annotation: c.annotation,
    state: c.state,
    isResolved: c.isResolved,
    isVisibleToClient: c.isVisibleToClient,
    createdAt: c.createdAt,
    author: c.author ? displayName(c.author) : (c.guestName ?? ''),
    resolvedBy: c.resolvedBy ? displayName(c.resolvedBy) : '',
    assignee: c.assignee ? displayName(c.assignee) : '',
  }));
  return { notes: orderThread(notes, mediaIds), truncated };
}

/**
 * Remet les notes dans l'ordre de lecture : clip par clip, racines par timecode croissant,
 * chaque réponse à la suite de sa racine. Une note sans timecode (3D, image) passe après
 * celles qui en portent un, dans l'ordre d'écriture.
 */
export function orderThread<T extends ExportNote>(notes: T[], mediaOrder: number[]): T[] {
  const rank = new Map(mediaOrder.map((id, index) => [id, index]));
  const byId = new Map(notes.map((n) => [n.id, n]));
  const replies = new Map<number, T[]>();
  const roots: T[] = [];
  for (const note of notes) {
    if (note.parentId !== null && byId.has(note.parentId)) {
      const bucket = replies.get(note.parentId) ?? [];
      bucket.push(note);
      replies.set(note.parentId, bucket);
    } else roots.push(note);
  }
  roots.sort((a, b) => {
    const clip = (rank.get(a.mediaObjectId) ?? 0) - (rank.get(b.mediaObjectId) ?? 0);
    if (clip !== 0) return clip;
    const ta = a.timestamp ?? Number.POSITIVE_INFINITY;
    const tb = b.timestamp ?? Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  const out: T[] = [];
  for (const root of roots) {
    out.push(root);
    const children = replies.get(root.id) ?? [];
    children.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    out.push(...children);
  }
  return out;
}

/** Frame affichée d'une note : celle que la review montre, base `startFrame` du projet. */
const displayFrame = (note: ExportNote, clip: ClipContext, startFrame: number): number | null =>
  note.timestamp === null ? null : startFrame + Math.round(note.timestamp * clip.fps);

function csvRows(notes: ExportNote[], byMedia: Map<number, ClipContext>, startFrame: number): NoteCsvRow[] {
  return notes.map((note) => {
    const clip = byMedia.get(note.mediaObjectId);
    const fps = clip?.fps ?? 24;
    const frame = clip ? displayFrame(note, clip, startFrame) : null;
    return {
      note_id: String(note.id),
      reply_to: note.parentId === null ? '' : String(note.parentId),
      sequence: clip?.sequence ?? '',
      shot: clip?.shot ?? '',
      task: clip?.task ?? '',
      version: clip?.version ?? '',
      media: clip?.mediaName ?? '',
      frame: frame === null ? '' : String(frame),
      timecode: note.timestamp === null ? '' : timecodeAt(note.timestamp, fps),
      range_frames: note.duration ? String(Math.max(1, Math.round(note.duration * fps))) : '',
      author: note.author,
      created_at: note.createdAt.toISOString(),
      state: note.state,
      resolved: note.isResolved ? 'true' : 'false',
      resolved_by: note.resolvedBy,
      assignee: note.assignee,
      decision: clip?.decision ?? '',
      client_visible: note.isVisibleToClient ? 'true' : 'false',
      annotated: note.annotation ? 'true' : 'false',
      content: flattenNoteText(note.text),
    };
  });
}

/** Position d'une note dans SON clip — le montage la range sur la timeline, pas le média. */
function offsetInClip(note: ExportNote, clipStart: number): number {
  if (note.timestamp !== null) return note.timestamp;
  if (note.timelineTime !== null) return Math.max(0, note.timelineTime - clipStart);
  return 0;
}

/** Libellé d'un marqueur : qui parle, puis ce qui est dit. */
const markerLabel = (note: ExportNote): string =>
  note.author ? `${note.author}: ${flattenNoteText(note.text)}` : flattenNoteText(note.text);

function editorialClips(clips: ClipContext[], notes: ExportNote[]): Array<EdlClip & OtioClip> {
  let start = 0;
  return clips.map((clip) => {
    const own = notes.filter((n) => n.mediaObjectId === clip.mediaId);
    const markers = own.map((note) => ({
      at: offsetInClip(note, start),
      span: note.duration ?? 0,
      color: STATE_COLOR[note.state],
      name: markerLabel(note),
      label: markerLabel(note),
      metadata: { noteId: note.id, state: note.state, author: note.author },
    }));
    start += clip.duration;
    return { name: clip.mediaName || clip.location, duration: clip.duration, url: null, markers };
  });
}

async function sheetNotes(
  notes: ExportNote[],
  byMedia: Map<number, ClipContext>,
  startFrame: number,
): Promise<SheetNote[]> {
  const images = createSheetImages();
  const out: SheetNote[] = [];
  for (const note of notes) {
    const clip = byMedia.get(note.mediaObjectId);
    const image = clip ? await images(clip, note.timestamp) : null;
    const frame = clip ? displayFrame(note, clip, startFrame) : null;
    out.push({
      location: clip?.location ?? '',
      frame: frame === null ? null : String(frame),
      timecode: note.timestamp === null ? null : timecodeAt(note.timestamp, clip?.fps ?? 24),
      author: note.author,
      createdAt: note.createdAt.toISOString().slice(0, 16).replace('T', ' '),
      state: note.state,
      decision: clip?.decision || null,
      text: note.text,
      image,
      annotationSvg: image ? annotationToSvg(note.annotation, image.width, image.height) : null,
      reply: note.parentId !== null,
    });
  }
  return out;
}

export interface ExportRequest {
  scope: NotesScope;
  id: number;
  format: NotesFormat;
  viewer: ExportViewer;
}

/** Produit le fichier demandé. Le projet a déjà été autorisé par la route. */
export async function exportNotes(req: ExportRequest): Promise<ExportedFile> {
  const { scope, id, format, viewer } = req;
  if (format !== 'csv' && format !== 'sheet' && !EDITORIAL_SCOPES.has(scope))
    throw badRequest('EDL and OTIO are only available for a playlist or a montage');
  const projectId = await resolveScopeProject(scope, id);
  if (projectId === null) throw notFound('Nothing to export here');
  const settings = await resolveProjectSettingsById(projectId);
  const { label, clips } = await collectClips(scope, id, viewer.id, settings.framerate);
  const limit = format === 'sheet' ? MAX_SHEET_NOTES : MAX_NOTES;
  const { notes, truncated } = await collectNotes(scope, id, clips, viewer, limit);
  const byMedia = new Map(clips.map((c) => [c.mediaId, c]));
  const filename = `notes-${scope}-${id}.${EXTENSIONS[format]}`;
  const file = { filename, contentType: CONTENT_TYPES[format], truncated };

  if (format === 'csv') {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { startFrame: true },
    });
    return { ...file, body: toNotesCsv(csvRows(notes, byMedia, project?.startFrame ?? 1001)) };
  }
  if (format === 'edl')
    return {
      ...file,
      body: toEdl({ title: label, fps: settings.framerate, clips: editorialClips(clips, notes) }),
    };
  if (format === 'otio')
    return {
      ...file,
      body: toOtio({ name: label, fps: settings.framerate, clips: editorialClips(clips, notes) }),
    };

  const [project, locale] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { startFrame: true, name: true } }),
    prisma.user
      .findUnique({ where: { id: viewer.id }, select: { preferences: true } })
      .then((u) => resolveUserLocale(u?.preferences)),
  ]);
  return {
    ...file,
    body: renderNotesSheet({
      title: t(locale, 'notesSheet.title'),
      subtitle: `${project?.name ?? ''} — ${label}`,
      labels: sheetLabels(locale),
      notes: await sheetNotes(notes, byMedia, project?.startFrame ?? 1001),
      truncated: truncated ? t(locale, 'notesSheet.truncated', { count: MAX_SHEET_NOTES }) : null,
    }),
  };
}
