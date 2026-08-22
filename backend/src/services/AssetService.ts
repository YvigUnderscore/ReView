// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AssetType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import {
  firstMediaThumbKeyForAsset,
  firstMediaThumbKeysForAssets,
  effectiveThumbnailUrl,
} from '../lib/thumbnails';
import { type PaginationParams, pageArgs, paginateCursor, withCursor } from '../lib/pagination';
import { enqueuePush } from './shotgrid/ShotgridPushService';

/** Logique métier des assets. L'accès projet (RBAC) est asserté dans la route (10.D8). */

/**
 * Versions et tâches ramenées par la fiche d'un asset.
 *
 * La fiche les affiche d'un bloc, sans pagination : le plafond évite qu'un asset repris
 * cent fois (un décor de long-métrage) ne rende la page proportionnelle à son historique.
 * Les compteurs `_count` disent le nombre réel.
 */
const DETAIL_LIMIT = 200;

/**
 * Assets paginés d'un projet + miniatures.
 *
 * Le nom est unique par projet, donc déjà discriminant, mais le départage sur `id` est
 * posé quand même : c'est la même règle partout, et elle ne dépend plus de la contrainte
 * d'unicité du modèle. Le curseur suit le couple `(name, id)`.
 */
export async function list(projectId: number, p: PaginationParams) {
  const where = { projectId, deletedAt: null };
  const [assets, total] = await Promise.all([
    prisma.asset.findMany({
      where: withCursor(where, p, 'name', 'asc'),
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      ...pageArgs(p),
      include: {
        _count: { select: { versions: true, tasks: true } },
        // Étapes et assignés : le menu contextuel des cartes en a besoin pour cocher
        // l'état courant. Sans eux, il faudrait une requête par carte affichée.
        departments: {
          select: { id: true, key: true, name: true, color: true },
          orderBy: { order: 'asc' },
        },
        tasks: {
          select: {
            id: true,
            departmentId: true,
            // Le nom de l'étape vient d'ici : une tâche peut vivre dans un département
            // que l'asset ne déclare pas, et le menu doit tout de même savoir le nommer.
            departmentRef: { select: { id: true, name: true } },
            assignee: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.asset.count({ where }),
  ]);
  // Requête groupée (B3) — cf. ShotService.list.
  const fallbacks = await firstMediaThumbKeysForAssets(assets.map((a) => a.id));
  const items = await Promise.all(
    assets.map(async (a) => ({
      ...a,
      thumbnailUrl: await effectiveThumbnailUrl(a.thumbnailKey, fallbacks.get(a.id) ?? null),
    })),
  );
  return paginateCursor(items, total, p, (a) => a.name);
}

/** Fiche complète d'un asset (versions, tâches, rattachements, vignette). */
export async function getDetail(id: number) {
  const asset = await prisma.asset.findUnique({
    where: { id },
    include: {
      _count: { select: { versions: true, tasks: true } },
      versions: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: DETAIL_LIMIT },
      tasks: {
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        take: DETAIL_LIMIT,
        include: { assignee: { select: { id: true, name: true } } },
      },
      shots: { where: { deletedAt: null }, select: { id: true, code: true, name: true, sequenceId: true } },
      sequences: { where: { deletedAt: null }, select: { id: true, code: true, name: true } },
      // Départements traversés (B1) : le panneau de réglages les coche (C3).
      departments: { select: { id: true, key: true, name: true, color: true }, orderBy: { order: 'asc' } },
    },
  });
  if (!asset) throw notFound('Asset not found');
  // La vignette n'était calculée que dans la liste : la page d'un asset ne montrait
  // jamais l'image, alors que celle d'un plan l'affichait.
  const thumbnailUrl = await effectiveThumbnailUrl(asset.thumbnailKey, await firstMediaThumbKeyForAsset(id));
  return { ...asset, thumbnailUrl };
}

export interface CreateAssetInput {
  projectId: number;
  name: string;
  type: AssetType;
  description?: string;
}

/**
 * Crée un asset. Le verrou ShotGrid (48) est vérifié par la route AVANT d'arriver ici :
 * il porte un lien de création distant que seule la couche HTTP sait présenter.
 */
export async function create(body: CreateAssetInput) {
  const { projectId, name, type, description } = body;
  if (await prisma.asset.findUnique({ where: { projectId_name: { projectId, name } } }))
    throw badRequest('An asset with this name already exists', 'NAME_TAKEN');
  return prisma.asset.create({
    data: { projectId, name, type, description: description ?? null },
  });
}

export interface UpdateAssetInput {
  name?: string;
  type?: AssetType;
  /**
   * Libellé exact du type tel que le studio le nomme (C3). La colonne existait depuis la
   * phase 48 mais n'était écrite que par la synchronisation ShotGrid : un studio autonome
   * ne pouvait pas nommer ses propres types.
   */
  typeLabel?: string | null;
  description?: string | null;
  thumbnailKey?: string | null;
  shotIds?: number[];
  sequenceIds?: number[];
}

/**
 * Met à jour un asset et, le cas échéant, ses rattachements. Shots et séquences sont
 * vérifiés comme appartenant au projet de l'asset : un identifiant venu d'un autre projet
 * créerait un lien invisible depuis les deux écrans concernés.
 */
export async function update(projectId: number, id: number, body: UpdateAssetInput) {
  const { shotIds, sequenceIds, ...scalar } = body;
  if (shotIds && shotIds.length > 0) {
    const ok = await prisma.shot.count({ where: { id: { in: shotIds }, projectId } });
    if (ok !== shotIds.length) throw badRequest('This shot does not belong to this project', 'BAD_SHOT');
  }
  if (sequenceIds && sequenceIds.length > 0) {
    const ok = await prisma.sequence.count({ where: { id: { in: sequenceIds }, projectId } });
    if (ok !== sequenceIds.length)
      throw badRequest('This sequence does not belong to this project', 'BAD_SEQUENCE');
  }
  const updated = await prisma.asset.update({
    where: { id },
    data: {
      ...scalar,
      ...(shotIds ? { shots: { set: shotIds.map((sid) => ({ id: sid })) } } : {}),
      ...(sequenceIds ? { sequences: { set: sequenceIds.map((sid) => ({ id: sid })) } } : {}),
    },
    include: {
      shots: { where: { deletedAt: null }, select: { id: true, code: true, name: true, sequenceId: true } },
      sequences: { where: { deletedAt: null }, select: { id: true, code: true, name: true } },
    },
  });
  // 48 : les rattachements remontent à ShotGrid, qui porte ces liens sur l'asset.
  if (shotIds || sequenceIds) await enqueuePush(projectId, { type: 'asset-links', assetId: id });
  return updated;
}
