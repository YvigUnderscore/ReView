// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { badRequest, conflict, notFound } from '../lib/errors';
import {
  effectiveThumbnailUrl,
  firstMediaThumbKeyForEpisode,
  firstMediaThumbKeysForEpisodes,
  firstMediaThumbKeysForShots,
} from '../lib/thumbnails';
import { pageArgs, paginate, type PaginationParams } from '../lib/pagination';

/**
 * Le niveau Épisode — logique métier.
 *
 * Un épisode groupe des séquences ; il ne porte ni plan ni version en propre. C'est un
 * niveau **facultatif par projet** : tant que `Project.episodesEnabled` est faux — ce
 * qu'il est par défaut — le serveur refuse toute écriture d'épisode et les écrans n'en
 * montrent aucune trace. Un long-métrage ne voit donc rien changer.
 *
 * Désactiver le réglage sur un projet qui a déjà des épisodes ne détruit RIEN : les
 * lignes restent, les rattachements aussi, et tout réapparaît intact à la réactivation.
 * C'est le seul comportement défendable — l'alternative (détacher ou supprimer) ferait
 * d'un interrupteur d'affichage une opération destructive irréversible, sur une donnée
 * que personne n'a demandé à perdre. En contrepartie, les lectures d'épisode répondent
 * 409 tant que le réglage est éteint : rien ne doit pouvoir se lire ou s'écrire par une
 * URL devinée pendant que l'interface prétend que le niveau n'existe pas.
 */

/**
 * Séquences et plans ramenés par la fiche d'un épisode. Même raison que pour la fiche
 * d'une séquence : la page n'est pas paginée, mais elle ne peut pas être non bornée.
 * Un épisode de série porte 100 à 300 plans ; le plafond ne mord pas dessus.
 */
const DETAIL_LIMIT = 500;

// ───────────────────────────── Le réglage ─────────────────────────────

/** Le niveau Épisode est-il activé sur ce projet ? Faux pour un projet inconnu. */
export async function isEnabled(projectId: number): Promise<boolean> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { episodesEnabled: true },
  });
  return project?.episodesEnabled ?? false;
}

/**
 * Refuse l'opération quand le niveau est éteint.
 *
 * 409 et non 403 : ce n'est pas une question de droits mais d'état du projet — la même
 * requête réussira dès que le studio aura activé le niveau.
 */
export async function assertEnabled(projectId: number): Promise<void> {
  if (!(await isEnabled(projectId))) {
    throw conflict('The Episode level is disabled on this project', 'EPISODES_DISABLED');
  }
}

/** Ce que l'écran de réglages a besoin de savoir pour proposer l'interrupteur. */
export interface EpisodeSettings {
  enabled: boolean;
  /** Épisodes vivants — ce que la désactivation va masquer, et rien de plus. */
  episodeCount: number;
  /** Séquences déjà rattachées : le décompte que l'avertissement affiche. */
  linkedSequenceCount: number;
}

export async function readSettings(projectId: number): Promise<EpisodeSettings> {
  const [project, episodeCount, linkedSequenceCount] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { episodesEnabled: true } }),
    prisma.episode.count({ where: { projectId, deletedAt: null, hiddenAt: null } }),
    prisma.sequence.count({
      where: { projectId, deletedAt: null, hiddenAt: null, episodeId: { not: null } },
    }),
  ]);
  if (!project) throw notFound('Project not found');
  return { enabled: project.episodesEnabled, episodeCount, linkedSequenceCount };
}

/** Bascule le réglage. Aucun épisode n'est touché — voir l'en-tête du fichier. */
export async function setEnabled(projectId: number, enabled: boolean): Promise<EpisodeSettings> {
  await prisma.project.update({ where: { id: projectId }, data: { episodesEnabled: enabled } });
  return readSettings(projectId);
}

// ───────────────────────────── Lecture ─────────────────────────────

/** Liste paginée des épisodes d'un projet, triée comme les séquences (`order`, puis `id`). */
export async function list(projectId: number, p: PaginationParams) {
  // `hiddenAt` : un épisode masqué disparaît des listes — cf. ShotService.list.
  const where = { projectId, deletedAt: null, hiddenAt: null };
  const [episodes, total] = await Promise.all([
    prisma.episode.findMany({
      where,
      // Départage sur `id` : un import laisse tous les épisodes à `order = 0`, et sans
      // départage la page 2 réafficherait des lignes de la page 1.
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      ...pageArgs(p),
      include: {
        _count: { select: { sequences: { where: { deletedAt: null, hiddenAt: null } } } },
      },
    }),
    prisma.episode.count({ where }),
  ]);
  const { pageCount, hasMore } = paginate(episodes, total, p);
  // Vignette effective de chaque épisode, en une passe : la sienne si elle a été choisie,
  // sinon la première image venue de ses plans. Sans cela, la liste renvoyait la clé de
  // stockage et aucune URL — les cartes d'épisodes ne pouvaient rien afficher.
  const withThumbs = await signEpisodeThumbnails(episodes);
  // Séquences du projet qu'aucun épisode ne réclame : un découpage en cours en laisse
  // toujours, et les taire ferait croire que le projet est vide.
  const unassignedSequences = await prisma.sequence.count({
    where: { projectId, deletedAt: null, hiddenAt: null, episodeId: null },
  });
  return {
    episodes: withThumbs,
    unassignedSequences,
    total,
    page: p.page,
    pageSize: p.pageSize,
    pageCount,
    hasMore,
  };
}

/** Vignette effective d'une liste d'épisodes, en une passe (liste du projet). */
export async function signEpisodeThumbnails<T extends { id: number; thumbnailKey: string | null }>(
  rows: T[],
): Promise<(T & { thumbnailUrl: string | null })[]> {
  const fallbacks = await firstMediaThumbKeysForEpisodes(rows.map((r) => r.id));
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      thumbnailUrl: await effectiveThumbnailUrl(row.thumbnailKey, fallbacks.get(row.id) ?? null),
    })),
  );
}

/** Fiche complète : les séquences de l'épisode, et les plans de ces séquences. */
export async function getDetail(id: number) {
  const episode = await prisma.episode.findUnique({
    where: { id },
    include: {
      sequences: {
        where: { deletedAt: null, hiddenAt: null },
        orderBy: [{ order: 'asc' }, { code: 'asc' }, { id: 'asc' }],
        take: DETAIL_LIMIT,
        include: {
          _count: { select: { shots: { where: { deletedAt: null, hiddenAt: null } } } },
        },
      },
      _count: { select: { sequences: { where: { deletedAt: null, hiddenAt: null } } } },
    },
  });
  if (!episode) throw notFound('Episode not found');

  const shots = await prisma.shot.findMany({
    where: { deletedAt: null, hiddenAt: null, sequence: { episodeId: id, deletedAt: null } },
    orderBy: [{ sequenceId: 'asc' }, { order: 'asc' }, { id: 'asc' }],
    take: DETAIL_LIMIT,
    select: {
      id: true,
      code: true,
      name: true,
      sequenceId: true,
      order: true,
      startFrame: true,
      endFrame: true,
      omitted: true,
      thumbnailKey: true,
      pipelineStatusId: true,
    },
  });
  // Une passe groupée pour toute la page, comme la fiche d'une séquence : la variante
  // unitaire signerait une URL MinIO par plan, soit trois cents allers-retours.
  const fallbacks = await firstMediaThumbKeysForShots(shots.map((s) => s.id));
  const shotsWithThumbs = await Promise.all(
    shots.map(async (s) => ({
      ...s,
      thumbnailUrl: await effectiveThumbnailUrl(s.thumbnailKey, fallbacks.get(s.id) ?? null),
    })),
  );

  return {
    ...episode,
    shots: shotsWithThumbs,
    shotCount: shotsWithThumbs.length,
    thumbnailUrl: await effectiveThumbnailUrl(episode.thumbnailKey, await firstMediaThumbKeyForEpisode(id)),
  };
}

// ───────────────────────────── Écriture ─────────────────────────────

export interface EpisodeInput {
  name: string;
  code: string;
  order?: number;
}

/** Premier code déjà pris parmi ceux du lot — `null` si le lot est libre. */
export function firstDuplicate(codes: string[]): string | null {
  return codes.find((c, i) => codes.indexOf(c) !== i) ?? null;
}

export async function create(projectId: number, input: EpisodeInput) {
  await assertEnabled(projectId);
  const taken = await prisma.episode.findUnique({
    where: { projectId_code: { projectId, code: input.code } },
  });
  if (taken) throw badRequest('An episode with this code already exists', 'CODE_TAKEN');
  return prisma.episode.create({
    data: { projectId, name: input.name, code: input.code, order: input.order ?? 0 },
  });
}

/** Création en lot : un doublon dans le lot ou en base annule tout, rien n'est créé. */
export async function createBulk(projectId: number, items: EpisodeInput[]) {
  await assertEnabled(projectId);
  const codes = items.map((i) => i.code);
  const dup = firstDuplicate(codes);
  if (dup) throw badRequest(`Duplicate code in the batch: ${dup}`, 'CODE_DUP');
  const existing = await prisma.episode.findMany({
    where: { projectId, code: { in: codes }, deletedAt: null },
    select: { code: true },
  });
  if (existing.length > 0) {
    throw badRequest(`Code already in use: ${existing.map((e) => e.code).join(', ')}`, 'CODE_TAKEN');
  }
  return prisma.$transaction(
    items.map((it, idx) =>
      prisma.episode.create({
        data: { projectId, name: it.name, code: it.code, order: it.order ?? idx },
      }),
    ),
  );
}

export interface UpdateEpisodeInput {
  name?: string;
  code?: string;
  order?: number;
  description?: string | null;
  pipelineStatusId?: number | null;
}

export async function update(id: number, projectId: number, body: UpdateEpisodeInput) {
  await assertEnabled(projectId);
  if (body.code !== undefined) {
    const clash = await prisma.episode.findFirst({
      where: { projectId, code: body.code, id: { not: id } },
      select: { id: true },
    });
    if (clash) throw badRequest('An episode with this code already exists', 'CODE_TAKEN');
  }
  return prisma.episode.update({ where: { id }, data: body });
}

/**
 * Réordonnancement : la liste reçue donne le nouvel ordre, du premier au dernier.
 *
 * Les identifiants étrangers au projet sont refusés en bloc plutôt qu'ignorés — une
 * requête partiellement appliquée laisserait un ordre que personne n'a demandé.
 */
export async function reorder(projectId: number, ids: number[]): Promise<void> {
  await assertEnabled(projectId);
  const owned = await prisma.episode.findMany({
    where: { id: { in: ids }, projectId, deletedAt: null },
    select: { id: true },
  });
  if (owned.length !== ids.length) {
    throw badRequest('This episode does not belong to this project', 'BAD_EPISODE');
  }
  await prisma.$transaction(
    ids.map((id, index) => prisma.episode.update({ where: { id }, data: { order: index } })),
  );
}

/**
 * Rattache (ou détache, avec `null`) des séquences à un épisode.
 *
 * Les deux côtés sont vérifiés : la séquence doit appartenir au projet, et l'épisode
 * aussi. Sans cela, un identifiant de séquence emprunté à un autre projet passerait dans
 * l'épisode d'un film voisin — et le rattachement ne se voit pas depuis la page.
 */
export async function assignSequences(
  projectId: number,
  episodeId: number | null,
  sequenceIds: number[],
): Promise<number> {
  await assertEnabled(projectId);
  if (episodeId !== null) {
    const episode = await prisma.episode.findFirst({
      where: { id: episodeId, projectId, deletedAt: null },
      select: { id: true },
    });
    if (!episode) throw badRequest('This episode does not belong to this project', 'BAD_EPISODE');
  }
  const { count } = await prisma.sequence.updateMany({
    where: { id: { in: sequenceIds }, projectId, deletedAt: null },
    data: { episodeId },
  });
  return count;
}

// La corbeille (mise à la corbeille, restauration, purge) vit dans `lib/trash`, avec
// celle des séquences, des plans et des assets : c'est de là que la sélection multiple
// et le balayage de rétention la pilotent.
