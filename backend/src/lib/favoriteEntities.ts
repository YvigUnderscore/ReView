// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { EntityType, Role } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Resolution of the sidebar favorites.
 *
 * Two defects were fixed together here.
 *
 * 1. **Access was never re-checked.** A favorite points to a project, a sequence, a shot or an asset; the
 *    route enriched them without ever asking whether the person still had access to the project. Removing
 *    someone from a film therefore did not remove the names of its shots: the sidebar kept showing
 *    `AAA_010 · Chute`, and the deep link led to a 403 — after having disclosed the name.
 * 2. **One query per favorite.** `resolveEntity` ran one `findUnique` per row, inside a `Promise.all`.
 *    Twenty favorites, twenty round trips. Reading is now one query per family (four at most), plus one
 *    for the memberships.
 *
 * The link and the label are **pure**: they are tested without a database.
 */

/** A favorite row as stored. */
export interface FavoriteRow {
  id: number;
  type: EntityType;
  entityId: number;
}

/** What the sidebar displays for a favorite. */
export interface FavoriteView extends FavoriteRow {
  label: string;
  projectId: number;
  to: string;
}

interface ResolvedEntity {
  label: string;
  projectId: number;
}

/**
 * Deep link of a favorite. A sequence has no page of its own: we open the project's Sequences tab and
 * expand the right one.
 */
export function favoritePath(type: EntityType, entityId: number, projectId: number): string {
  switch (type) {
    case EntityType.PROJECT:
      return `/projects/${projectId}`;
    case EntityType.SEQUENCE:
      return `/projects/${projectId}?tab=sequences&seq=${entityId}`;
    case EntityType.SHOT:
      return `/shots/${entityId}`;
    case EntityType.ASSET:
      return `/assets/${entityId}`;
  }
}

/** Label of a favorite: the code precedes the name wherever the pipeline gives one. */
export function favoriteLabel(type: EntityType, entity: { code?: string | null; name: string }): string {
  const coded = type === EntityType.SEQUENCE || type === EntityType.SHOT;
  return coded && entity.code ? `${entity.code} · ${entity.name}` : entity.name;
}

const key = (type: EntityType, entityId: number): string => `${type}:${entityId}`;

const idsOf = (rows: readonly FavoriteRow[], type: EntityType): number[] =>
  rows.filter((r) => r.type === type).map((r) => r.entityId);

/**
 * Loads the entities referenced by the favorites — one query per non-empty family.
 * A deleted entity (trash) does not enter the table: the favorite disappears.
 *
 * A project in the trash counts as deleted for everything it carries: putting a project in the trash does not
 * cascade to its shots (`lib/trash`), and without this filter the sidebar kept displaying — hence disclosing —
 * the name of a shot of a removed project, whose deep link now leads to a 404 (`middleware/rbac`).
 */
async function loadEntities(rows: readonly FavoriteRow[]): Promise<Map<string, ResolvedEntity>> {
  const [projects, sequences, shots, assets] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: idsOf(rows, EntityType.PROJECT) }, deletedAt: null },
      select: { id: true, name: true },
    }),
    prisma.sequence.findMany({
      where: {
        id: { in: idsOf(rows, EntityType.SEQUENCE) },
        deletedAt: null,
        hiddenAt: null,
        project: { deletedAt: null },
      },
      select: { id: true, code: true, name: true, projectId: true },
    }),
    prisma.shot.findMany({
      where: {
        id: { in: idsOf(rows, EntityType.SHOT) },
        deletedAt: null,
        hiddenAt: null,
        project: { deletedAt: null },
      },
      select: { id: true, code: true, name: true, projectId: true },
    }),
    prisma.asset.findMany({
      where: {
        id: { in: idsOf(rows, EntityType.ASSET) },
        deletedAt: null,
        hiddenAt: null,
        project: { deletedAt: null },
      },
      select: { id: true, name: true, projectId: true },
    }),
  ]);

  const out = new Map<string, ResolvedEntity>();
  for (const p of projects)
    out.set(key(EntityType.PROJECT, p.id), {
      label: favoriteLabel(EntityType.PROJECT, p),
      projectId: p.id,
    });
  for (const s of sequences)
    out.set(key(EntityType.SEQUENCE, s.id), {
      label: favoriteLabel(EntityType.SEQUENCE, s),
      projectId: s.projectId,
    });
  for (const s of shots)
    out.set(key(EntityType.SHOT, s.id), {
      label: favoriteLabel(EntityType.SHOT, s),
      projectId: s.projectId,
    });
  for (const a of assets)
    out.set(key(EntityType.ASSET, a.id), {
      label: favoriteLabel(EntityType.ASSET, a),
      projectId: a.projectId,
    });
  return out;
}

/**
 * Projects, among those referenced, that the person still has access to. Same rule as `checkProjectAccess`,
 * but in one query: ADMIN and SUPERVISOR see everything, the others go through their membership.
 */
export async function accessibleProjectIds(
  userId: number,
  role: Role,
  projectIds: readonly number[],
): Promise<Set<number>> {
  if (role === Role.ADMIN || role === Role.SUPERVISOR) return new Set(projectIds);
  if (projectIds.length === 0) return new Set();
  const memberships = await prisma.projectMembership.findMany({
    where: { userId, projectId: { in: [...projectIds] } },
    select: { projectId: true },
  });
  return new Set(memberships.map((m) => m.projectId));
}

/** Enriched favorites, in the order received, without those whose project is no longer open. */
export async function resolveFavorites(
  userId: number,
  role: Role,
  rows: readonly FavoriteRow[],
): Promise<FavoriteView[]> {
  if (rows.length === 0) return [];
  const entities = await loadEntities(rows);
  const allowed = await accessibleProjectIds(userId, role, [
    ...new Set([...entities.values()].map((e) => e.projectId)),
  ]);

  const out: FavoriteView[] = [];
  for (const row of rows) {
    const entity = entities.get(key(row.type, row.entityId));
    if (!entity || !allowed.has(entity.projectId)) continue;
    out.push({
      id: row.id,
      type: row.type,
      entityId: row.entityId,
      label: entity.label,
      projectId: entity.projectId,
      to: favoritePath(row.type, row.entityId, entity.projectId),
    });
  }
  return out;
}
