// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { effectiveThumbnailUrl, firstMediaThumbKeysForShots } from '../lib/thumbnails';
import { storage } from './StorageService';

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

/** Fiche complète d'une séquence : ses plans, ses assets, sa vignette, ses départements. */
export async function getDetail(id: number) {
  const sequence = await prisma.sequence.findUnique({
    where: { id },
    include: {
      shots: {
        where: { deletedAt: null },
        // `id` en dernier départage : les plans d'un import partagent `order = 0`, et le
        // code ne suffit pas quand deux séquences fusionnées portent la même numérotation.
        orderBy: [{ order: 'asc' }, { code: 'asc' }, { id: 'asc' }],
        take: DETAIL_LIMIT,
        include: {
          _count: { select: { tasks: true } },
          assets: { where: { deletedAt: null }, select: { id: true, name: true, type: true } },
        },
      },
      assets: {
        where: { deletedAt: null },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: DETAIL_LIMIT,
        select: { id: true, name: true, type: true, typeLabel: true, thumbnailKey: true },
      },
      _count: { select: { shots: { where: { deletedAt: null } } } },
      departments: { select: { id: true, key: true, name: true, color: true }, orderBy: { order: 'asc' } },
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
  const fallbacks = await firstMediaThumbKeysForShots(shotIds);
  const shots = await Promise.all(
    sequence.shots.map(async (s) => ({
      ...s,
      thumbnailUrl: await effectiveThumbnailUrl(s.thumbnailKey, fallbacks.get(s.id) ?? null),
    })),
  );
  const assets = await Promise.all(
    sequence.assets.map(async (a) => ({
      ...a,
      thumbnailUrl: a.thumbnailKey ? await storage.getPresignedGetUrl(a.thumbnailKey) : null,
    })),
  );

  const { project, ...rest } = sequence;
  return {
    ...rest,
    episode: project.episodesEnabled ? sequence.episode : null,
    shots,
    assets,
    thumbnailUrl: sequence.thumbnailKey ? await storage.getPresignedGetUrl(sequence.thumbnailKey) : null,
  };
}
