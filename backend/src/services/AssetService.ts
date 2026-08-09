// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AssetType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest } from '../lib/errors';

/** Logique métier des assets. L'accès projet (RBAC) est asserté dans la route (10.D8). */

export interface UpdateAssetInput {
  name?: string;
  type?: AssetType;
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
    if (ok !== shotIds.length) throw badRequest('Shot invalide pour ce projet', 'BAD_SHOT');
  }
  if (sequenceIds && sequenceIds.length > 0) {
    const ok = await prisma.sequence.count({ where: { id: { in: sequenceIds }, projectId } });
    if (ok !== sequenceIds.length) throw badRequest('Séquence invalide pour ce projet', 'BAD_SEQUENCE');
  }
  return prisma.asset.update({
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
}
