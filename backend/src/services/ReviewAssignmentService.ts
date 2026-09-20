// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { WatchTargetType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { assertProjectWritable } from '../lib/projectGuard';
import { isProjectManager } from '../lib/projectRoles';
import {
  checkReviewNote,
  resolveProjectSettingsById,
  reviewNoteSchema,
  REVIEW_NOTE_MAX_LENGTH,
  type ReviewRequestRule,
} from '../lib/projectSettings';
import type { SessionUser } from '../lib/shotgridAccess';
import { logAudit } from './AuditService';
import { notify } from './NotificationService';
import { setWatch } from './WatchService';
import { emitToProject } from './SocketService';
import { publish as publishApiEvent } from './ApiEventService';
import {
  ASSIGNEE_SELECT,
  assertAssignable,
  toAssigneeView,
  type AssigneeView,
} from './EntityAssigneeService';

/**
 * Qui doit regarder cette version (Phase 49), et **ce qu'il doit y regarder**.
 *
 * La décision de review existait déjà (`ReviewDecisionService`) : elle dit ce qu'on a
 * conclu d'une livraison. Ce qui manquait, c'est le geste d'avant — **confier** cette
 * livraison à quelqu'un. Il se disait de vive voix ou dans un fil de discussion, donc il
 * se perdait : personne ne pouvait ouvrir ReView et répondre à « qu'est-ce qu'on attend de
 * moi ? ». L'encart « Assigned to me » de la page Reviews lit exactement cette liste-là.
 *
 * Il y manquait encore la moitié utile. Savoir qu'on est attendu sans savoir SUR QUOI ne
 * fait gagner du temps qu'à celui qui assigne : le destinataire ouvrait quatre minutes de
 * playblast sans savoir si on lui demandait la lumière, le timing ou le raccord. Chaque
 * assignation porte donc une **consigne**, et c'est elle qui fait la différence entre
 * « regarde ça » et « regarde le raccord au 1042, le reste est validé ».
 *
 * Deux règles de projet l'encadrent (`settings.reviewRequest`) : l'exiger, et lui donner
 * une longueur minimale. Elles sont vérifiées **ici**, pas dans la route : la même
 * assignation arrive de l'écran de décision, de la publication d'un brouillon et de l'API
 * d'intégration — trois portes d'entrée pour une règle métier en font trois occasions de
 * l'oublier.
 *
 * Assigner n'ouvre aucun droit et n'en retire aucun : c'est une attente, pas une
 * délégation. La décision reste réservée au superviseur du projet, et un artiste à qui on
 * confie une version la regarde et la commente — comme il pouvait déjà le faire.
 */

/** Au-delà, ce n'est plus une assignation mais une diffusion : c'est à quoi sert la playlist. */
export const MAX_REVIEWERS = 20;

/**
 * Une attente de review, telle que l'API la rend : la personne — même forme que partout
 * ailleurs — et la consigne écrite POUR ELLE.
 *
 * La consigne est posée à plat sur la personne plutôt que dans un objet englobant : les
 * écrans qui affichaient déjà la liste (`AssigneeStack`, l'encart « Assigned to me ») la
 * lisent inchangés, et ceux qui veulent la consigne la trouvent au même endroit.
 */
export type ReviewerView = AssigneeView & { note: string | null };

/** Ce qu'un appelant fournit pour confier une version à quelqu'un. */
export interface ReviewerInput {
  userId: number;
  note?: string | null;
}

/**
 * La liste telle que les TROIS portes d'écriture l'acceptent : l'écran de décision, la
 * publication d'un brouillon, et l'API d'intégration. Un seul schéma pour les trois — trois
 * copies auraient divergé à la première borne changée, et la porte oubliée aurait accepté
 * ce que les deux autres refusent.
 *
 * Il vit ici et non dans `lib/projectSettings` parce que c'est `MAX_REVIEWERS` qui le
 * borne, et que cette borne est une règle de l'assignation, pas du réglage de consigne.
 */
export const reviewersSchema = z
  .array(z.object({ userId: z.number().int().positive(), note: reviewNoteSchema }))
  .max(MAX_REVIEWERS);

/** La version, son projet, son auteur, et de quoi écrire la notification. */
async function loadVersion(versionId: number) {
  const version = await prisma.version.findFirst({
    where: { id: versionId, deletedAt: null },
    select: { id: true, name: true, taskId: true, assetId: true, authorId: true },
  });
  if (!version) throw notFound('Version not found');
  return version;
}

const SELECT = { note: true, reviewer: { select: ASSIGNEE_SELECT } } as const;

/** Les personnes confiées à cette version, photos signées — ordre stable (par id). */
export async function listReviewers(versionId: number): Promise<ReviewerView[]> {
  const rows = await prisma.reviewAssignment.findMany({
    where: { versionId },
    orderBy: { reviewerId: 'asc' },
    select: SELECT,
  });
  return Promise.all(rows.map(async (row) => ({ ...(await toAssigneeView(row.reviewer)), note: row.note })));
}

/**
 * Qui peut confier une review, et donc écrire la consigne.
 *
 * Le gestionnaire du projet, évidemment : répartir les reviews est son métier. Mais aussi
 * **l'auteur de la version** — c'est lui qui vient de livrer, lui qui sait ce qu'il y a à
 * regarder, et c'est au moment de l'upload que la consigne a le plus de valeur. Le lui
 * refuser aurait fait du réglage « consigne obligatoire à l'upload » une règle que
 * l'uploader ne pouvait pas satisfaire.
 *
 * Cela n'élargit aucun droit de décision : l'artiste désigne qui regarde, il ne conclut
 * pas la review (38.E).
 */
async function assertCanAssign(
  actor: SessionUser,
  projectId: number,
  authorId: number | null,
): Promise<void> {
  await assertProjectWritable(projectId);
  if (actor.id === authorId) return;
  if (!(await isProjectManager(actor.id, actor.role, projectId)))
    throw forbidden('Only the author of this version or a project manager can assign its review');
}

/**
 * Normalise une consigne et la confronte à la règle du projet.
 *
 * L'espace seul ne fait pas une consigne : elle est mesurée après `trim`, et une consigne
 * vide est stockée `null` plutôt qu'en chaîne vide — deux représentations du même rien
 * auraient donné deux affichages différents selon la porte d'entrée.
 */
export function normalizeNote(note: string | null | undefined, rule: ReviewRequestRule): string | null {
  const verdict = checkReviewNote(note, rule);
  if (verdict === 'missing')
    throw badRequest('This project requires a brief when assigning a review', 'REVIEW_NOTE_REQUIRED');
  if (verdict === 'too-short')
    throw badRequest(
      `A reviewer brief must be at least ${rule.minNoteLength} characters`,
      'REVIEW_NOTE_TOO_SHORT',
    );
  const text = (note ?? '').trim();
  return text ? text.slice(0, REVIEW_NOTE_MAX_LENGTH) : null;
}

/**
 * Remplace la liste des personnes chargées de la review d'une version, consignes comprises.
 *
 * Remplacement et non ajout : l'appelant envoie la liste qu'il veut voir, et deux
 * enregistrements concurrents ne peuvent pas laisser un assigné fantôme que personne n'a
 * choisi. Même arbitrage que `EntityAssigneeService.setAssignees`, et même garde-fou sur
 * qui peut recevoir du travail — sinon l'un des deux chemins devient la porte de service
 * de l'autre.
 *
 * Une personne déjà confiée voit sa consigne mise à jour au lieu d'être retirée puis
 * remise : sans quoi elle serait prévenue à chaque enregistrement, et réabonnée à une
 * version dont elle s'était peut-être désabonnée.
 */
export async function setReviewers(
  actor: SessionUser,
  projectId: number,
  versionId: number,
  entries: ReviewerInput[],
): Promise<ReviewerView[]> {
  const version = await loadVersion(versionId);
  await assertCanAssign(actor, projectId, version.authorId);

  // Une même personne citée deux fois n'est pas une erreur à refuser : la dernière consigne
  // gagne, comme à l'écran où la seconde ligne écrase la première.
  const rule = (await resolveProjectSettingsById(projectId)).reviewRequest;
  const wanted = new Map<number, string | null>();
  for (const entry of entries) wanted.set(entry.userId, normalizeNote(entry.note, rule));
  await assertAssignable(projectId, [...wanted.keys()]);

  const previous = await prisma.reviewAssignment.findMany({
    where: { versionId },
    select: { reviewerId: true, note: true },
  });
  const before = new Map(previous.map((row) => [row.reviewerId, row.note]));

  await prisma.$transaction([
    prisma.reviewAssignment.deleteMany({ where: { versionId, reviewerId: { notIn: [...wanted.keys()] } } }),
    ...[...wanted].map(([reviewerId, note]) =>
      prisma.reviewAssignment.upsert({
        where: { versionId_reviewerId: { versionId, reviewerId } },
        create: { versionId, reviewerId, note, assignedById: actor.id },
        update: { note, assignedById: actor.id },
      }),
    ),
  ]);

  // Prévenir seulement ce qui a changé POUR LA PERSONNE : une assignation neuve, ou une
  // consigne réécrite. Réenregistrer la même liste sans rien y toucher ne réveille personne.
  const added: number[] = [];
  const rewritten: number[] = [];
  for (const [reviewerId, note] of wanted) {
    if (reviewerId === actor.id) continue;
    if (!before.has(reviewerId)) added.push(reviewerId);
    else if (before.get(reviewerId) !== note) rewritten.push(reviewerId);
  }
  if (added.length > 0) await announce(added, projectId, version, 'assigned');
  if (rewritten.length > 0) await announce(rewritten, projectId, version, 'note');

  return afterWrite(actor, projectId, version, [...wanted.keys()]);
}

/**
 * Réécrit la consigne d'une personne déjà confiée, sans toucher au reste de la liste.
 *
 * C'est le geste courant d'après-coup — « ajoute-lui ce qu'il faut regarder ». Passer par
 * `setReviewers` aurait exigé de renvoyer la liste entière, donc de la relire, et deux
 * écrans ouverts se seraient effacés l'un l'autre.
 */
export async function updateNote(
  actor: SessionUser,
  projectId: number,
  versionId: number,
  reviewerId: number,
  note: string | null,
): Promise<ReviewerView[]> {
  const version = await loadVersion(versionId);
  await assertCanAssign(actor, projectId, version.authorId);
  const current = await prisma.reviewAssignment.findUnique({
    where: { versionId_reviewerId: { versionId, reviewerId } },
    select: { note: true },
  });
  if (!current) throw notFound('This person is not assigned to this review');

  const clean = normalizeNote(note, (await resolveProjectSettingsById(projectId)).reviewRequest);
  if (clean !== current.note) {
    await prisma.reviewAssignment.update({
      where: { versionId_reviewerId: { versionId, reviewerId } },
      data: { note: clean, assignedById: actor.id },
    });
    if (reviewerId !== actor.id) await announce([reviewerId], projectId, version, 'note');
  }
  return afterWrite(actor, projectId, version, null);
}

/** La version telle que les écritures se la passent entre elles. */
type LoadedVersion = Awaited<ReturnType<typeof loadVersion>>;

/**
 * Ce que toute écriture fait ensuite : tracer, réveiller les écrans ouverts sur la version,
 * informer les intégrations, et rendre la liste à jour.
 *
 * `userIds` n'est tracé que lorsque la liste elle-même a changé — une consigne réécrite ne
 * modifie pas qui est attendu, et le faire croire au journal d'audit serait faux.
 */
async function afterWrite(
  actor: SessionUser,
  projectId: number,
  version: LoadedVersion,
  userIds: number[] | null,
): Promise<ReviewerView[]> {
  const reviewers = await listReviewers(version.id);
  logAudit({
    userId: actor.id,
    action: userIds ? 'version.reviewers' : 'version.reviewer_note',
    entityType: 'Version',
    entityId: version.id,
    ...(userIds ? { metadata: { userIds } } : {}),
  });
  emitToProject(projectId, 'version:update', {
    projectId,
    id: version.id,
    taskId: version.taskId,
    assetId: version.assetId,
  });
  publishApiEvent('version.reviewers_changed', {
    projectId,
    entityType: 'version',
    entityId: version.id,
    actorId: actor.id,
    payload: {
      versionId: version.id,
      reviewers: reviewers.map((person) => ({ userId: person.id, note: person.note })),
    },
  });
  return reviewers;
}

/**
 * Prévient les personnes concernées — et abonne les nouvelles à la version.
 *
 * La notification d'assignation seule aurait laissé le reviewer dans le noir jusqu'à ce
 * qu'il pense à rouvrir l'écran : les retours et la décision qui suivent sont précisément
 * ce qu'il attend. Le suivi (32.G) les lui fait parvenir, et il reste le sien — le retirer
 * de la liste ne le désabonne pas, puisqu'il a pu le poser lui-même entre-temps. Une
 * consigne réécrite ne réabonne personne : la décision d'arrêter de suivre lui appartient.
 *
 * La référence pointe le premier média de la version : c'est ce qui rend la notification
 * navigable jusqu'à l'écran de review (même choix que la décision).
 */
async function announce(
  userIds: number[],
  projectId: number,
  version: LoadedVersion,
  kind: 'assigned' | 'note',
): Promise<void> {
  const firstMedia = await prisma.mediaObject.findFirst({
    where: { versionId: version.id, deletedAt: null },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  await Promise.all(
    userIds.map(async (userId) => {
      if (kind === 'assigned') await setWatch(userId, WatchTargetType.VERSION, version.id, true);
      await notify({
        userId,
        kind: 'reviewAssigned',
        messageKey: kind === 'assigned' ? 'notification.reviewAssigned' : 'notification.reviewNoteUpdated',
        params: { version: version.name },
        projectId,
        referenceId: firstMedia?.id ?? null,
      });
    }),
  );
}
