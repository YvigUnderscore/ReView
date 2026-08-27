// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { EntityNote, NoteTemplate } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { assertProjectWritable } from '../lib/projectGuard';
import { assertProjectManage } from '../lib/projectRoles';
import type { SessionUser } from '../lib/shotgridAccess';

/**
 * La fiche d'une entité : du markdown enrichi, écrit dans ReView et par personne d'autre.
 *
 * `description` vient de ShotGrid et y retourne : une ligne, souvent en lecture seule ici.
 * La fiche est l'inverse — c'est là que vit le brief, avec ses titres dépliables, ses
 * jauges d'avancement et son carrousel de références. Les confondre aurait signifié qu'une
 * synchronisation écrase le brief, ce qui arrive une fois et suffit à ne plus rien y écrire.
 *
 * Le rendu (titres dépliables, `::progress`, `::divider`, carrousel) est entièrement côté
 * client : le serveur garde du texte, jamais du HTML. C'est ce qui rend la fiche exportable
 * et empêche l'injection par construction plutôt que par assainissement.
 */

export const NOTE_KINDS = ['episode', 'sequence', 'shot', 'asset'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const TEMPLATE_SCOPES = ['all', ...NOTE_KINDS] as const;
export type TemplateScope = (typeof TEMPLATE_SCOPES)[number];

/**
 * Plafond de taille d'une fiche.
 *
 * Cent mille caractères, soit une quarantaine de pages : au-delà, ce n'est plus un brief
 * mais un document, et il a sa place ailleurs. La borne protège surtout la charge utile
 * envoyée à chaque ouverture de page.
 */
const MAX_BODY = 100_000;

/** La colonne de rattachement d'un type — une seule est renseignée (CHECK `EntityNote_target_xor`). */
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

/** Le projet de l'entité, et son existence. Une fiche sans projet ne serait lisible nulle part. */
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

/** La fiche d'une entité — vide plutôt qu'absente : l'écran affiche toujours l'encart. */
export async function getNote(kind: NoteKind, id: number): Promise<NoteView> {
  const note = await prisma.entityNote.findFirst({
    where: targetOf(kind, id),
    include: { updatedBy: { select: AUTHOR_SELECT } },
  });
  if (!note) return { body: '', updatedAt: null, updatedBy: null };
  return { body: note.body, updatedAt: note.updatedAt, updatedBy: note.updatedBy };
}

/**
 * Écrit la fiche.
 *
 * Une fiche vidée est **supprimée** plutôt que gardée vide : sinon l'écran afficherait
 * « modifiée par Alice il y a deux minutes » sur un encart sans contenu, et la liste des
 * entités documentées serait fausse.
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

// ───────────────────────────── Modèles de fiche ─────────────────────────────

/**
 * Les modèles proposés à une entité : ceux du projet d'abord, ceux du studio ensuite.
 *
 * Un modèle de portée `all` est proposé partout — c'est le cas du « Brief » générique.
 * Les deux niveaux se cumulent au lieu de se remplacer : un projet qui définit ses propres
 * modèles n'a aucune raison de perdre ceux du studio.
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
