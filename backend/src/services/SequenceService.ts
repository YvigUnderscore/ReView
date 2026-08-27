// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { assertProjectWritable } from '../lib/projectGuard';
import * as PipelineStatusService from './PipelineStatusService';
import { assertDescriptionWritable } from './shotgrid/ShotgridGuardService';
import { enqueuePush } from './shotgrid/ShotgridPushService';
import {
  effectiveThumbnailUrl,
  firstMediaThumbKeyForSequence,
  firstMediaThumbKeysForAssets,
  firstMediaThumbKeysForSequences,
  firstMediaThumbKeysForShots,
} from '../lib/thumbnails';
import { CARD_ASSIGNEE_SELECT, awaitingReviewByShot, signAssignees } from '../lib/entityCardData';

/**
 * Logique métier des séquences (C3).
 *
 * Une séquence n'avait pas de page : c'était un accordéon dans un onglet, et son montage
 * se cachait derrière un dépliage. Le détail renvoyé ici est donc celui d'une vraie fiche
 * — sa vignette, ses départements, et ses plans avec de quoi les reconnaître (image,
 * statut, plage de frames) plutôt qu'une liste de codes.
 *
 * Les vignettes de plans sont résolues en une passe groupée : la variante unitaire dans
 * un `.map` signait une URL MinIO par plan, ce qui rendait l'ouverture lente bien avant
 * qu'une séquence n'atteigne cent plans.
 */

/**
 * Plans et assets ramenés par la fiche d'une séquence.
 *
 * La fiche les affiche d'un bloc : elle n'est pas paginée, mais elle ne peut pas non plus
 * être non bornée — une séquence mal découpée porterait la moitié du long-métrage. Le
 * plafond est haut pour ne jamais mordre sur un découpage sain (une séquence dépasse
 * rarement la centaine de plans) et `shotCount`/`assetCount` disent le compte réel.
 */
const DETAIL_LIMIT = 500;

export interface BulkSequenceItem {
  name: string;
  code: string;
  order?: number;
  /**
   * Épisode d'accueil (niveau facultatif, cf. `EpisodeService`). Absent ou `null` : la
   * séquence reste hors épisode — l'état normal d'un long-métrage, et celui d'un projet
   * où le niveau n'est pas activé.
   */
  episodeId?: number | null;
}

/**
 * Les épisodes cités appartiennent-ils bien à ce projet ?
 *
 * Sans ce contrôle, un identifiant emprunté à un autre film rangerait la séquence dans
 * l'épisode du voisin — et le rattachement ne se voit depuis aucune des deux pages.
 */
async function assertEpisodesInProject(projectId: number, items: BulkSequenceItem[]): Promise<void> {
  const ids = [...new Set(items.map((i) => i.episodeId).filter((v): v is number => typeof v === 'number'))];
  if (ids.length === 0) return;
  const owned = await prisma.episode.count({ where: { id: { in: ids }, projectId, deletedAt: null } });
  if (owned !== ids.length) {
    throw badRequest('This episode does not belong to this project', 'BAD_EPISODE');
  }
}

/** Création en lot : un doublon dans le lot ou en base annule tout, rien n'est créé. */
export async function createBulk(projectId: number, items: BulkSequenceItem[]) {
  const codes = items.map((i) => i.code);
  const dupInBatch = codes.find((c, i) => codes.indexOf(c) !== i);
  if (dupInBatch) throw badRequest(`Duplicate code in the batch: ${dupInBatch}`, 'CODE_DUP');
  const existing = await prisma.sequence.findMany({
    where: { projectId, code: { in: codes }, deletedAt: null },
    select: { code: true },
  });
  if (existing.length > 0) {
    throw badRequest(`Code already in use: ${existing.map((e) => e.code).join(', ')}`, 'CODE_TAKEN');
  }
  await assertEpisodesInProject(projectId, items);
  return prisma.$transaction(
    items.map((it, idx) =>
      prisma.sequence.create({
        data: {
          projectId,
          name: it.name,
          code: it.code,
          order: it.order ?? idx,
          episodeId: it.episodeId ?? null,
        },
      }),
    ),
  );
}

/** Ce qu'un PATCH de séquence peut porter — la route l'a déjà validé (Zod). */
export interface UpdateSequenceInput {
  name?: string;
  code?: string;
  order?: number;
  episodeId?: number | null;
  description?: string | null;
  pipelineStatusId?: number | null;
  settings?: Prisma.InputJsonValue;
}

/**
 * Modifie une séquence, avec les deux allers-retours ShotGrid qu'elle entraîne.
 *
 * La route se contentait d'écrire en base : le statut restait local — le site gardait
 * l'ancien et la synchronisation suivante ramenait sa valeur, si bien que le changement
 * s'annulait tout seul — et la description n'était protégée par rien.
 */
export async function update(
  id: number,
  projectId: number,
  body: UpdateSequenceInput,
  actorId?: number | null,
) {
  await assertProjectWritable(projectId); // 38.B : projet archivé = lecture seule
  // La description peut être tenue par ShotGrid : l'écrire ici la ferait diverger jusqu'à
  // ce que la synchronisation suivante l'écrase, sans rien dire à personne.
  if (body.description !== undefined) await assertDescriptionWritable(projectId);
  // Le statut doit venir du vocabulaire de CE projet, comme pour une tâche.
  if (body.pipelineStatusId !== undefined) {
    await PipelineStatusService.assertBelongsToProject(projectId, 'sequence', body.pipelineStatusId);
  }
  const sequence = await prisma.sequence.update({ where: { id }, data: body });
  if (body.pipelineStatusId !== undefined) {
    await enqueuePush(projectId, { type: 'sequence-status', sequenceId: id, actorId });
  }
  if (body.description !== undefined) {
    await enqueuePush(projectId, { type: 'description', kind: 'sequence', id, actorId });
  }
  return sequence;
}

/** Fiche complète d'une séquence : ses plans, ses assets, sa vignette, ses départements. */
export async function getDetail(id: number) {
  const sequence = await prisma.sequence.findUnique({
    where: { id },
    include: {
      shots: {
        where: { deletedAt: null, hiddenAt: null },
        // `id` en dernier départage : les plans d'un import partagent `order = 0`, et le
        // code ne suffit pas quand deux séquences fusionnées portent la même numérotation.
        orderBy: [{ order: 'asc' }, { code: 'asc' }, { id: 'asc' }],
        take: DETAIL_LIMIT,
        include: {
          _count: { select: { tasks: true } },
          assets: {
            where: { deletedAt: null, hiddenAt: null },
            select: { id: true, name: true, type: true },
          },
          // La page de séquence affiche ses plans avec la carte de l'onglet Plans :
          // elle a donc besoin des mêmes visages.
          assignees: { select: CARD_ASSIGNEE_SELECT, orderBy: { id: 'asc' } },
        },
      },
      assets: {
        where: { deletedAt: null, hiddenAt: null },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: DETAIL_LIMIT,
        select: { id: true, name: true, type: true, typeLabel: true, thumbnailKey: true },
      },
      _count: { select: { shots: { where: { deletedAt: null, hiddenAt: null } } } },
      departments: { select: { id: true, key: true, name: true, color: true }, orderBy: { order: 'asc' } },
      assignees: { select: CARD_ASSIGNEE_SELECT, orderBy: { id: 'asc' } },
      // Épisode d'appartenance (niveau facultatif) : la page de séquence en fait un lien
      // de remontée. `null` sur un long-métrage — la fiche ne montre alors rien de plus.
      episode: { select: { id: true, code: true, name: true } },
      // Le réglage du projet, pour taire l'épisode quand le niveau est éteint : le
      // rattachement survit à l'extinction (rien n'est détruit), mais il ne doit alors
      // laisser aucune trace à l'écran.
      project: { select: { episodesEnabled: true } },
    },
  });
  if (!sequence) throw notFound('Sequence not found');

  const shotIds = sequence.shots.map((s) => s.id);
  const [fallbacks, awaiting, signedShots] = await Promise.all([
    firstMediaThumbKeysForShots(shotIds),
    awaitingReviewByShot(shotIds),
    signAssignees(sequence.shots),
  ]);
  const shots = await Promise.all(
    signedShots.map(async (s) => ({
      ...s,
      thumbnailUrl: await effectiveThumbnailUrl(s.thumbnailKey, fallbacks.get(s.id) ?? null),
      awaitingReview: awaiting.get(s.id) ?? 0,
    })),
  );
  // Les assets de la fiche n'avaient droit qu'à leur vignette choisie : ils apparaissaient
  // vides alors que leurs versions portaient des images. Même règle que partout ailleurs.
  const assetFallbacks = await firstMediaThumbKeysForAssets(sequence.assets.map((a) => a.id));
  const assets = await Promise.all(
    sequence.assets.map(async (a) => ({
      ...a,
      thumbnailUrl: await effectiveThumbnailUrl(a.thumbnailKey, assetFallbacks.get(a.id) ?? null),
    })),
  );

  const { project, ...rest } = sequence;
  return {
    ...rest,
    episode: project.episodesEnabled ? sequence.episode : null,
    shots,
    assets,
    thumbnailUrl: await effectiveThumbnailUrl(sequence.thumbnailKey, await firstMediaThumbKeyForSequence(id)),
  };
}

/**
 * Vignette effective d'une liste de séquences, en une passe (arbre de la sidebar, onglet
 * Séquences, fiche d'un épisode). La liste n'en renvoyait aucune : les cartes de séquences
 * restaient grises quoi qu'il arrive, faute d'URL signée — le champ n'était même pas là.
 */
export async function signSequenceThumbnails<T extends { id: number; thumbnailKey: string | null }>(
  rows: T[],
): Promise<(T & { thumbnailUrl: string | null })[]> {
  const fallbacks = await firstMediaThumbKeysForSequences(rows.map((r) => r.id));
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      thumbnailUrl: await effectiveThumbnailUrl(row.thumbnailKey, fallbacks.get(row.id) ?? null),
    })),
  );
}
