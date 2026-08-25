// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AssetType, type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  firstMediaThumbKeyForShot,
  firstMediaThumbKeysForShots,
  effectiveThumbnailUrl,
} from '../lib/thumbnails';
import { emitToProject } from './SocketService';
import * as PipelineStatusService from './PipelineStatusService';
import { enqueuePush } from './shotgrid/ShotgridPushService';
import { badRequest, notFound } from '../lib/errors';
import { type PaginationParams, pageArgs, paginateCursor, withCursor } from '../lib/pagination';
import { assertProjectWritable } from '../lib/projectGuard';
import { assertDescriptionWritable } from './shotgrid/ShotgridGuardService';
import { CARD_ASSIGNEE_SELECT, awaitingReviewByShot } from '../lib/entityCardData';

/**
 * Logique métier des shots (liste + miniatures, création simple/lot avec unicité de
 * code par séquence, rattachement d'assets, corbeille). L'accès projet (RBAC) est
 * asserté dans la route ; ces fonctions reçoivent des paramètres validés (10.D8).
 */

/**
 * Filtre d'épisode d'une liste de plans (niveau facultatif, cf. `EpisodeService`).
 *
 * Un plan n'appartient pas à un épisode : c'est sa séquence qui en porte un. Le filtre
 * traverse donc la relation, et `none` désigne les plans dont la séquence est hors
 * épisode — ainsi que ceux qui n'ont pas de séquence du tout, qui sont hors épisode par
 * construction. Undefined : aucune restriction, exactement le comportement d'avant.
 */
export function episodeWhere(episode: number | 'none' | undefined): Prisma.ShotWhereInput {
  if (episode === undefined) return {};
  if (episode === 'none') return { OR: [{ sequenceId: null }, { sequence: { episodeId: null } }] };
  return { sequence: { episodeId: Number(episode) } };
}

/**
 * Shots paginés d'un projet (filtre séquence : id, `none` = hors séquence, ou tous ;
 * filtre épisode : id, `none` = hors épisode, ou tous) + miniatures.
 *
 * Le tri se départage sur `id` : un import ShotGrid incrémental laisse tous les plans
 * créés à `order = 0`, et sans départage Postgres est libre de rendre ces ex æquo dans
 * un ordre différent d'une page à l'autre — la page 2 réaffiche alors des plans de la
 * page 1 et en saute autant. Le curseur (`p.cursor`) suit le même couple `(order, id)`.
 */
export async function list(
  projectId: number,
  seq: number | 'none' | undefined,
  p: PaginationParams,
  episode?: number | 'none',
) {
  const seqFilter =
    seq === 'none' ? { sequenceId: null } : seq !== undefined ? { sequenceId: Number(seq) } : {};
  // `hiddenAt` : un plan masqué (VisibilityService) n'apparaît dans aucune liste, pour
  // personne. Le filtre est inconditionnel — y compris pour un admin, qui gère les
  // éléments masqués depuis l'écran d'administration prévu pour ça et nulle part ailleurs.
  // Le laisser paraître « seulement pour l'admin » aurait rendu tous les décomptes faux
  // selon qui regarde.
  const where = { projectId, deletedAt: null, hiddenAt: null, ...seqFilter, ...episodeWhere(episode) };
  const [shots, total] = await Promise.all([
    prisma.shot.findMany({
      where: withCursor(where, p, 'order', 'asc'),
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      ...pageArgs(p),
      include: {
        _count: { select: { tasks: true } },
        assets: { where: { deletedAt: null, hiddenAt: null }, select: { id: true, name: true, type: true } },
        // Étapes traversées (B1) : le filtre par département de l'onglet Shots s'appuie
        // dessus. La fiche d'un plan les renvoyait, la liste non — choisir un département
        // vidait donc l'écran, faute d'étape à comparer sur chaque carte.
        departments: {
          select: { id: true, key: true, name: true, color: true },
          orderBy: { order: 'asc' },
        },
        // Étapes et assignés, comme `AssetService.list` : le sous-menu « Assigner » du clic
        // droit lit `hasTask` par département. Sans eux il s'affichait entièrement grisé sur
        // un projet piloté depuis ShotGrid — les deux onglets divergeaient pour cette
        // seule raison.
        tasks: {
          select: {
            id: true,
            departmentId: true,
            departmentRef: { select: { id: true, name: true } },
            assignee: { select: { id: true, name: true } },
          },
        },
        // Personnes responsables du plan : la carte les montre en photos. Sans elles
        // ici, chaque carte aurait demandé sa propre requête.
        assignees: { select: CARD_ASSIGNEE_SELECT, orderBy: { id: 'asc' } },
      },
    }),
    prisma.shot.count({ where }),
  ]);
  // Une requête groupée pour toute la page (B3) : la variante unitaire dans un `.map`
  // envoyait une requête et une signature MinIO par plan, soit deux cents allers-retours
  // pour une page de cent.
  const ids = shots.map((s) => s.id);
  const [fallbacks, awaiting] = await Promise.all([
    firstMediaThumbKeysForShots(ids),
    awaitingReviewByShot(ids),
  ]);
  const items = await Promise.all(
    shots.map(async (s) => ({
      ...s,
      thumbnailUrl: await effectiveThumbnailUrl(s.thumbnailKey, fallbacks.get(s.id) ?? null),
      awaitingReview: awaiting.get(s.id) ?? 0,
    })),
  );
  return paginateCursor(items, total, p, (s) => s.order);
}

/** Vérifie que la séquence (si fournie) appartient bien au projet. */
async function assertSequenceInProject(sequenceId: number | null | undefined, projectId: number) {
  if (!sequenceId) return;
  const seq = await prisma.sequence.findUnique({ where: { id: sequenceId }, select: { projectId: true } });
  if (!seq || seq.projectId !== projectId)
    throw badRequest('This sequence does not belong to this project', 'BAD_SEQUENCE');
}

export interface CreateShotInput {
  projectId: number;
  sequenceId?: number | null;
  name: string;
  code: string;
  startFrame?: number | null;
  endFrame?: number | null;
  order?: number;
  settings?: Prisma.InputJsonValue;
}

export async function create(input: CreateShotInput) {
  await assertProjectWritable(input.projectId); // 38.B : projet archivé = lecture seule
  await assertSequenceInProject(input.sequenceId, input.projectId);
  // Unicité du code par séquence (les shots sans séquence sont un groupe à part).
  const clash = await prisma.shot.findFirst({
    where: {
      projectId: input.projectId,
      sequenceId: input.sequenceId ?? null,
      code: input.code,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (clash) throw badRequest('A shot with this code already exists in this sequence', 'CODE_TAKEN');
  return prisma.shot.create({
    data: {
      projectId: input.projectId,
      sequenceId: input.sequenceId ?? null,
      name: input.name,
      code: input.code,
      startFrame: input.startFrame ?? null,
      endFrame: input.endFrame ?? null,
      order: input.order ?? 0,
      settings: input.settings ?? {},
    },
  });
}

export type BulkShotItem = Omit<CreateShotInput, 'projectId'>;

export async function createBulk(projectId: number, items: BulkShotItem[]) {
  await assertProjectWritable(projectId); // 38.B
  // Les séquences référencées doivent appartenir au projet.
  const seqIds = [...new Set(items.map((i) => i.sequenceId).filter((v): v is number => !!v))];
  if (seqIds.length > 0) {
    const ok = await prisma.sequence.count({ where: { id: { in: seqIds }, projectId } });
    if (ok !== seqIds.length)
      throw badRequest('This sequence does not belong to this project', 'BAD_SEQUENCE');
  }
  // Doublons (code, séquence) dans le lot.
  const key = (sid: number | null | undefined, code: string) => `${sid ?? 'none'}::${code}`;
  const keys = items.map((i) => key(i.sequenceId, i.code));
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup) throw badRequest(`Duplicate code in the batch : ${dup.split('::')[1]}`, 'CODE_DUP');
  // Conflits avec l'existant.
  const existing = await prisma.shot.findMany({
    where: { projectId, deletedAt: null, code: { in: items.map((i) => i.code) } },
    select: { code: true, sequenceId: true },
  });
  const existingKeys = new Set(existing.map((e) => key(e.sequenceId, e.code)));
  const clash = items.find((i) => existingKeys.has(key(i.sequenceId, i.code)));
  if (clash)
    throw badRequest(`A shot with this code already exists in this sequence: ${clash.code}`, 'CODE_TAKEN');
  return prisma.$transaction(
    items.map((it, idx) =>
      prisma.shot.create({
        data: {
          projectId,
          sequenceId: it.sequenceId ?? null,
          name: it.name,
          code: it.code,
          startFrame: it.startFrame ?? null,
          endFrame: it.endFrame ?? null,
          order: it.order ?? idx,
        },
      }),
    ),
  );
}

/** Détail d'un shot (séquence, tâches, assets). Renvoie aussi projectId pour l'assertion d'accès. */
export async function get(id: number) {
  const shot = await prisma.shot.findUnique({
    where: { id },
    include: {
      sequence: true,
      // Départage sur `id` : deux tâches créées par le même import partagent `order = 0`.
      tasks: {
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        include: { assignee: { select: { id: true, name: true } } },
      },
      assets: { where: { deletedAt: null }, select: { id: true, name: true, type: true } },
      // Départements traversés (B1) : le panneau de réglages les coche (C3).
      departments: { select: { id: true, key: true, name: true, color: true }, orderBy: { order: 'asc' } },
    },
  });
  if (!shot) throw notFound('Shot not found');
  // La miniature n'était calculée que dans la liste : une page de plan n'a pas de liste
  // derrière elle, et affichait donc un en-tête vide.
  return {
    ...shot,
    thumbnailUrl: await effectiveThumbnailUrl(shot.thumbnailKey, await firstMediaThumbKeyForShot(shot.id)),
  };
}

export interface UpdateShotInput {
  sequenceId?: number | null;
  name?: string;
  code?: string;
  startFrame?: number | null;
  endFrame?: number | null;
  order?: number;
  description?: string | null;
  thumbnailKey?: string | null;
  settings?: Prisma.InputJsonValue;
  /** Statut du plan (C3) — jusqu'ici écrit par la seule synchronisation ShotGrid. */
  pipelineStatusId?: number | null;
  /** Omis du montage (Phase 45) : le plan reste en base, les timelines le sautent. */
  omitted?: boolean;
}

export async function update(id: number, projectId: number, body: UpdateShotInput, actorId?: number | null) {
  await assertProjectWritable(projectId); // 38.B
  await assertSequenceInProject(body.sequenceId, projectId);
  // Le statut doit venir du vocabulaire de CE projet : poser l'identifiant d'un statut
  // importé du site d'un autre projet passerait sans bruit et fausserait la lecture.
  if (body.pipelineStatusId !== undefined) {
    await PipelineStatusService.assertBelongsToProject(projectId, 'shot', body.pipelineStatusId);
  }
  // La description peut être tenue par ShotGrid : l'écrire ici la ferait diverger
  // jusqu'à ce que la synchronisation suivante l'écrase, sans rien dire à personne.
  if (body.description !== undefined) await assertDescriptionWritable(projectId);
  // Si le code ou la séquence change, vérifier l'unicité (code unique par séquence).
  if (body.code !== undefined || body.sequenceId !== undefined) {
    const current = await prisma.shot.findUnique({ where: { id }, select: { code: true, sequenceId: true } });
    const nextCode = body.code ?? current!.code;
    const nextSequenceId = body.sequenceId !== undefined ? body.sequenceId : current!.sequenceId;
    const conflict = await prisma.shot.findFirst({
      where: { projectId, sequenceId: nextSequenceId, code: nextCode, deletedAt: null, id: { not: id } },
      select: { id: true },
    });
    if (conflict) throw badRequest('A shot with this code already exists in this sequence', 'CODE_TAKEN');
  }
  const shot = await prisma.shot.update({ where: { id }, data: body });
  // Ordre, plage de frames, omission, séquence : tout cela déplace les plans dans les
  // montages automatiques, qui doivent se remettre à jour sans rechargement (Phase 45).
  emitToProject(projectId, 'timeline:update', { projectId, shotId: id });
  // Le statut repart vers ShotGrid. Il ne partait nulle part : le plan changeait d'état
  // dans ReView, le site gardait l'ancien, et la synchronisation suivante ramenait
  // celui du site. L'artiste voyait son changement s'annuler tout seul.
  if (body.pipelineStatusId !== undefined) {
    await enqueuePush(projectId, { type: 'shot-status', shotId: id, actorId });
  }
  // Aller-retour de description, quand le studio l'a ouvert : sans cet envoi, la
  // modification locale serait effacée par la synchronisation suivante.
  if (body.description !== undefined) {
    await enqueuePush(projectId, { type: 'description', kind: 'shot', id, actorId });
  }
  return shot;
}

export interface AttachAssetInput {
  assetId?: number;
  name?: string;
  type?: AssetType;
}

/** Rattache un asset existant OU en crée un et le rattache au shot. */
export async function attachAsset(shotId: number, projectId: number, body: AttachAssetInput) {
  await assertProjectWritable(projectId); // 38.B
  let assetId = body.assetId;
  if (assetId === undefined) {
    if (await prisma.asset.findUnique({ where: { projectId_name: { projectId, name: body.name! } } }))
      throw badRequest('An asset with this name already exists', 'NAME_TAKEN');
    const created = await prisma.asset.create({
      data: { projectId, name: body.name!, type: body.type ?? AssetType.OTHER },
    });
    assetId = created.id;
  } else {
    const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { projectId: true } });
    if (!asset || asset.projectId !== projectId)
      throw badRequest('This asset does not belong to this project', 'BAD_ASSET');
  }
  await prisma.shot.update({ where: { id: shotId }, data: { assets: { connect: { id: assetId } } } });
  return prisma.asset.findUnique({ where: { id: assetId }, select: { id: true, name: true, type: true } });
}

export async function detachAsset(shotId: number, assetId: number) {
  await prisma.shot.update({ where: { id: shotId }, data: { assets: { disconnect: { id: assetId } } } });
}
