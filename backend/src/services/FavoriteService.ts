// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { EntityType, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  resolveProjectIdForAsset,
  resolveProjectIdForSequence,
  resolveProjectIdForShot,
} from '../lib/pipeline';
import { resolveFavorites, type FavoriteView } from '../lib/favoriteEntities';

/**
 * Sidebar favorites of a user. Access to the entity's project is asserted by the route (it holds the
 * request); this service owns the storage and the enrichment.
 */

/** Project containing a favoritable entity, or `null` when the entity does not exist. */
export async function projectIdForEntity(type: EntityType, entityId: number): Promise<number | null> {
  switch (type) {
    case 'PROJECT':
      return entityId;
    case 'SEQUENCE':
      return resolveProjectIdForSequence(entityId);
    case 'SHOT':
      return resolveProjectIdForShot(entityId);
    case 'ASSET':
      return resolveProjectIdForAsset(entityId);
  }
}

/**
 * The user's favorites, newest first, enriched — and filtered by current project access: a favorite is
 * not an acquired right, the sidebar must not keep naming the shots of a film one has left.
 */
export async function listFavorites(user: { id: number; role: Role }): Promise<FavoriteView[]> {
  const favorites = await prisma.favorite.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, type: true, entityId: true },
  });
  return resolveFavorites(user.id, user.role, favorites);
}

/** Adds a favorite (idempotent). */
export function addFavorite(userId: number, type: EntityType, entityId: number) {
  return prisma.favorite.upsert({
    where: { userId_type_entityId: { userId, type, entityId } },
    update: {},
    create: { userId, type, entityId },
  });
}

/** Removes a favorite (idempotent: no error when it was not there). */
export async function removeFavorite(userId: number, type: EntityType, entityId: number): Promise<void> {
  await prisma.favorite.deleteMany({ where: { userId, type, entityId } });
}
