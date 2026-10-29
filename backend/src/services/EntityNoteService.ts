// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { EntityNote, NoteTemplate } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { assertProjectWritable } from '../lib/projectGuard';
import { assertProjectManage } from '../lib/projectRoles';
import type { SessionUser } from '../lib/shotgridAccess';

/**
 * An entity's sheet: enriched markdown, written in ReView and by no one else.
 *
 * `description` comes from ShotGrid and stays there: a single line, often read-only here.
 * The sheet is the opposite — that is where the brief lives, with its collapsible headings,
 * progress gauges and reference carousel. Confusing them would have meant a sync overwriting the brief, which
 * happens once and is enough to stop anyone writing in it.
 *
 * Rendering (collapsible headings, `::progress`, `::divider`, carousel) is entirely client-side: the server
 * keeps text, never HTML. This keeps the sheet exportable and prevents injection by construction rather than
 * by sanitization.
 */

export const NOTE_KINDS = ['episode', 'sequence', 'shot', 'asset'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const TEMPLATE_SCOPES = ['all', ...NOTE_KINDS] as const;
export type TemplateScope = (typeof TEMPLATE_SCOPES)[number];

/**
 * Size ceiling of a sheet.
 *
 * One hundred thousand characters, about forty pages: beyond that, it is no longer a brief but a document,
 * and it belongs elsewhere. The bound mainly protects the payload sent on every page opening.
 */
const MAX_BODY = 100_000;

/** The attachment column of a type — only one is filled (CHECK `EntityNote_target_xor`). */
function targetOf(kind: NoteKind, id: number) {
  switch (kind) {
    case 'episode':
      return { episodeId: id };
    case 'sequence':
      return { sequenceId: id };
    case 'shot':
      return { shotId: id };
    case 'asset':
      return { assetId: id };
  }
}

/** The entity's project, and its existence. A sheet without a project would be readable nowhere. */
export async function resolveProject(kind: NoteKind, id: number): Promise<number> {
  const select = { projectId: true };
  const row =
    kind === 'episode'
      ? await prisma.episode.findFirst({ where: { id, deletedAt: null }, select })
      : kind === 'sequence'
        ? await prisma.sequence.findFirst({ where: { id, deletedAt: null }, select })
        : kind === 'shot'
          ? await prisma.shot.findFirst({ where: { id, deletedAt: null }, select })
          : await prisma.asset.findFirst({ where: { id, deletedAt: null }, select });
  if (!row) throw notFound('Entity not found');
  return row.projectId;
}

export interface NoteView {
  body: string;
  updatedAt: Date | null;
  updatedBy: { id: number; name: string | null; username: string | null; avatarKey: string | null } | null;
}

const AUTHOR_SELECT = { id: true, name: true, username: true, avatarKey: true } as const;

/** The sheet of an entity — empty rather than absent: the screen always displays the panel. */
export async function getNote(kind: NoteKind, id: number): Promise<NoteView> {
  const note = await prisma.entityNote.findFirst({
    where: targetOf(kind, id),
    include: { updatedBy: { select: AUTHOR_SELECT } },
  });
  if (!note) return { body: '', updatedAt: null, updatedBy: null };
  return { body: note.body, updatedAt: note.updatedAt, updatedBy: note.updatedBy };
}

/**
 * Writes the sheet.
 *
 * An emptied sheet is **deleted** rather than kept empty: otherwise the screen would show "modified by Alice
 * two minutes ago" on a panel with no content, and the list of documented entities would be wrong.
 */
export async function setNote(
  actor: SessionUser,
  kind: NoteKind,
  id: number,
  body: string,
): Promise<NoteView> {
  if (body.length > MAX_BODY) throw badRequest('This note is too long', 'NOTE_TOO_LONG');
  const projectId = await resolveProject(kind, id);
  await assertProjectWritable(projectId);
  await assertProjectManage(actor.id, actor.role, projectId);

  const target = targetOf(kind, id);
  const existing = await prisma.entityNote.findFirst({ where: target, select: { id: true } });
  const trimmed = body.trim();

  if (!trimmed) {
    if (existing) await prisma.entityNote.delete({ where: { id: existing.id } });
    return { body: '', updatedAt: null, updatedBy: null };
  }

  const note: EntityNote & {
    updatedBy: { id: number; name: string | null; username: string | null; avatarKey: string | null } | null;
  } = existing
    ? await prisma.entityNote.update({
        where: { id: existing.id },
        data: { body: trimmed, updatedById: actor.id },
        include: { updatedBy: { select: AUTHOR_SELECT } },
      })
    : await prisma.entityNote.create({
        data: { projectId, ...target, body: trimmed, updatedById: actor.id },
        include: { updatedBy: { select: AUTHOR_SELECT } },
      });
  return { body: note.body, updatedAt: note.updatedAt, updatedBy: note.updatedBy };
}

// ───────────────────────────── Sheet templates ─────────────────────────────

/**
 * The templates offered to an entity: those of the project first, then those of the studio.
 *
 * A template of scope `all` is offered everywhere — that is the case of the generic "Brief". The two levels
 * accumulate rather than replace each other: a project defining its own
 * templates has no reason to lose those of the studio.
 */
export async function listTemplates(
  studioId: number,
  projectId: number | null,
  scope?: TemplateScope,
): Promise<NoteTemplate[]> {
  return prisma.noteTemplate.findMany({
    where: {
      studioId,
      ...(projectId === null ? { projectId: null } : { OR: [{ projectId: null }, { projectId }] }),
      ...(scope && scope !== 'all' ? { scope: { in: ['all', scope] } } : {}),
    },
    orderBy: [{ projectId: 'desc' }, { scope: 'asc' }, { name: 'asc' }],
  });
}

export interface TemplateInput {
  projectId?: number | null;
  scope: TemplateScope;
  name: string;
  body: string;
}

export async function createTemplate(
  studioId: number,
  authorId: number | null,
  input: TemplateInput,
): Promise<NoteTemplate> {
  assertTemplate(input);
  return prisma.noteTemplate.create({
    data: {
      studioId,
      projectId: input.projectId ?? null,
      scope: input.scope,
      name: input.name.trim(),
      body: input.body,
      createdById: authorId,
    },
  });
}

export async function updateTemplate(
  studioId: number,
  id: number,
  input: Partial<TemplateInput>,
): Promise<NoteTemplate> {
  const existing = await prisma.noteTemplate.findFirst({ where: { id, studioId } });
  if (!existing) throw notFound('Template not found');
  const merged = {
    scope: (input.scope ?? existing.scope) as TemplateScope,
    name: input.name ?? existing.name,
    body: input.body ?? existing.body,
  };
  assertTemplate(merged);
  return prisma.noteTemplate.update({
    where: { id },
    data: { scope: merged.scope, name: merged.name.trim(), body: merged.body },
  });
}

export async function deleteTemplate(studioId: number, id: number): Promise<void> {
  const existing = await prisma.noteTemplate.findFirst({ where: { id, studioId }, select: { id: true } });
  if (!existing) throw notFound('Template not found');
  await prisma.noteTemplate.delete({ where: { id } });
}

function assertTemplate(input: { scope: TemplateScope; name: string; body: string }): void {
  if (!TEMPLATE_SCOPES.includes(input.scope)) throw badRequest('Unknown template scope', 'BAD_SCOPE');
  if (!input.name.trim()) throw badRequest('A template needs a name', 'NAME_REQUIRED');
  if (input.body.length > MAX_BODY) throw badRequest('This template is too long', 'NOTE_TOO_LONG');
}
