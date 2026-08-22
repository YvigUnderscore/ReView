// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { EntityType, Role } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Résolution des favoris de la barre latérale.
 *
 * Deux défauts se corrigeaient ensemble ici.
 *
 * 1. **L'accès n'était jamais revérifié.** Un favori porte un projet, une séquence, un
 *    plan ou un asset ; la route les enrichissait sans jamais redemander si la personne
 *    a encore accès au projet. Retirer quelqu'un d'un film ne lui retirait donc pas les
 *    noms de ses plans : la barre latérale continuait d'afficher `AAA_010 · Chute`, et le
 *    lien profond menait à un 403 — après avoir divulgué le nom.
 * 2. **Une requête par favori.** `resolveEntity` faisait un `findUnique` par ligne, dans
 *    un `Promise.all`. Vingt favoris, vingt allers-retours. La lecture se fait désormais
 *    en une requête par famille (quatre au plus), plus une pour les appartenances.
 *
 * Le lien et le libellé, eux, sont **purs** : ils se testent sans base.
 */

/** Ligne de favori telle qu'elle est stockée. */
export interface FavoriteRow {
  id: number;
  type: EntityType;
  entityId: number;
}

/** Ce que la barre latérale affiche pour un favori. */
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
 * Lien profond d'un favori. Une séquence n'a pas de page à elle : on ouvre l'onglet
 * Séquences du projet et on déplie la bonne.
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

/** Libellé d'un favori : le code précède le nom là où le pipeline en donne un. */
export function favoriteLabel(type: EntityType, entity: { code?: string | null; name: string }): string {
  const coded = type === EntityType.SEQUENCE || type === EntityType.SHOT;
  return coded && entity.code ? `${entity.code} · ${entity.name}` : entity.name;
}

const key = (type: EntityType, entityId: number): string => `${type}:${entityId}`;

const idsOf = (rows: readonly FavoriteRow[], type: EntityType): number[] =>
  rows.filter((r) => r.type === type).map((r) => r.entityId);

/**
 * Charge les entités citées par les favoris — une requête par famille non vide.
 * Une entité supprimée (corbeille) n'entre pas dans la table : le favori disparaît.
 */
async function loadEntities(rows: readonly FavoriteRow[]): Promise<Map<string, ResolvedEntity>> {
  const [projects, sequences, shots, assets] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: idsOf(rows, EntityType.PROJECT) }, deletedAt: null },
      select: { id: true, name: true },
    }),
    prisma.sequence.findMany({
      where: { id: { in: idsOf(rows, EntityType.SEQUENCE) }, deletedAt: null },
      select: { id: true, code: true, name: true, projectId: true },
    }),
    prisma.shot.findMany({
      where: { id: { in: idsOf(rows, EntityType.SHOT) }, deletedAt: null },
      select: { id: true, code: true, name: true, projectId: true },
    }),
    prisma.asset.findMany({
      where: { id: { in: idsOf(rows, EntityType.ASSET) }, deletedAt: null },
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
 * Projets, parmi ceux cités, auxquels la personne a encore accès. Même règle que
 * `checkProjectAccess`, mais en une requête : ADMIN et SUPERVISOR voient tout, les autres
 * passent par leur appartenance.
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

/** Favoris enrichis, dans l'ordre reçu, privés de ceux dont le projet n'est plus ouvert. */
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
