// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { storage } from '../services/StorageService';
import { logger } from './logger';

/**
 * Purge des dérivés obsolètes (37.H) : les versions au-delà des N dernières de chaque
 * tâche/asset perdent leurs renditions HLS et leur sprite de timeline — le proxy MP4 et
 * la miniature restent, la lecture reste donc possible (en qualité proxy). Configurable
 * (Setting `derived_purge`), déclenchable à la main (admin) et passée quotidiennement.
 */

export interface DerivedPurgeConfig {
  enabled: boolean;
  keepVersions: number; // N dernières versions conservées intactes par tâche/asset
}

const PURGE_KEY = 'derived_purge';
const FALLBACK: DerivedPurgeConfig = { enabled: false, keepVersions: 3 };

function sanitize(raw: unknown, base: DerivedPurgeConfig): DerivedPurgeConfig {
  const o = (raw ?? {}) as Partial<DerivedPurgeConfig>;
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : base.enabled,
    keepVersions: Number.isFinite(o.keepVersions)
      ? Math.min(Math.max(Math.round(Number(o.keepVersions)), 1), 100)
      : base.keepVersions,
  };
}

export const derivedPurgeSchema = z.object({
  enabled: z.boolean().optional(),
  keepVersions: z.number().int().min(1).max(100).optional(),
});

export async function getDerivedPurgeConfig(): Promise<DerivedPurgeConfig> {
  const row = await prisma.setting.findUnique({ where: { key: PURGE_KEY } });
  if (!row) return FALLBACK;
  try {
    return sanitize(JSON.parse(row.value), FALLBACK);
  } catch {
    return FALLBACK;
  }
}

export async function setDerivedPurgeConfig(value: unknown): Promise<DerivedPurgeConfig> {
  const clean = sanitize(value, FALLBACK);
  await prisma.setting.upsert({
    where: { key: PURGE_KEY },
    update: { value: JSON.stringify(clean) },
    create: { key: PURGE_KEY, value: JSON.stringify(clean) },
  });
  return clean;
}

/** Ids de versions à purger : tout sauf les N plus récentes de chaque groupe (pur, testé). */
export function selectObsoleteVersionIds(
  versions: { id: number; taskId: number | null; assetId: number | null }[],
  keep: number,
): number[] {
  const groups = new Map<string, number[]>();
  for (const v of versions) {
    const key = v.taskId != null ? `t${v.taskId}` : v.assetId != null ? `a${v.assetId}` : `v${v.id}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(v.id);
  }
  const out: number[] = [];
  for (const ids of groups.values()) {
    ids.sort((a, b) => b - a);
    out.push(...ids.slice(keep));
  }
  return out;
}

/**
 * Nombre de PARENTS (tâches, puis assets) traités par lot.
 *
 * POURQUOI ce découpage-là et pas un autre : le groupe de `selectObsoleteVersionIds` **est**
 * le parent (`t{taskId}` ou `a{assetId}`), et la contrainte `Version_parent_xor` garantit
 * qu'une version en a exactement un. Découper par parents rend donc EXACTEMENT le même
 * ensemble d'ids obsolètes qu'un chargement global — ce qui ne serait pas vrai d'un
 * découpage par id de version, qui couperait un groupe en deux et « conserverait » N
 * versions dans chaque moitié. Mesuré : le chargement global rapatriait toute la table
 * (20 000 versions = 5,4 Mo de tas pour UN projet ; vingt projets = 110 Mo d'un bloc dans
 * le process qui fait aussi tourner FFmpeg).
 */
const PURGE_PARENT_BATCH = 200;

/** Ids de versions passés d'un coup dans un `IN (…)` — une liste sans borne est un plan de requête sans borne. */
const PURGE_VERSION_IN_BATCH = 500;

/**
 * Plafond de médias allégés par passe. Chaque élément coûte deux appels MinIO **et** une
 * écriture : vider d'un coup l'arriéré d'un long-métrage occuperait le worker pendant que
 * le studio travaille. La purge est idempotente et reprend à la passe suivante — même
 * raisonnement que `TRASH_PURGE_MAX_ITEMS` (lib/trash.ts).
 */
export const DERIVED_PURGE_MAX_ITEMS = 2000;

/** Découpe une liste en tranches d'au plus `size` éléments (ordre conservé). */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Une page d'ids de parents ayant au moins une version vivante, par id croissant.
 * Le seul critère est « au moins une version vivante » — exactement ce que voyait le
 * chargement global, qui ne regardait pas non plus si la tâche/l'asset était en corbeille.
 */
async function parentIdsWithLiveVersions(
  parent: 'task' | 'asset',
  after: number | undefined,
): Promise<number[]> {
  const where = { versions: { some: { deletedAt: null } } };
  const page = {
    select: { id: true },
    orderBy: { id: 'asc' as const },
    take: PURGE_PARENT_BATCH,
    ...(after !== undefined ? { skip: 1, cursor: { id: after } } : {}),
  };
  const rows =
    parent === 'task'
      ? await prisma.task.findMany({ where, ...page })
      : await prisma.asset.findMany({ where, ...page });
  return rows.map((r) => r.id);
}

/** Allège un média (HLS + sprite) s'il porte encore des dérivés. `false` = rien à faire. */
async function purgeOneMedia(m: { id: number; metadata: unknown }): Promise<boolean> {
  const meta = { ...((m.metadata ?? {}) as Record<string, unknown>) };
  if (meta.hlsPurged === true || (!meta.hls && !meta.timelineSprite)) return false;
  const sprite = meta.timelineSprite as { key?: string } | undefined;
  // Les deux suppressions sont indépendantes : les attendre l'une après l'autre doublait
  // la latence MinIO par média sans rien ordonner.
  await Promise.all([
    storage.deletePrefix(`derived/${m.id}/hls/`).catch(() => undefined),
    sprite?.key ? storage.deleteObject(sprite.key).catch(() => undefined) : Promise.resolve(),
  ]);
  delete meta.hls;
  delete meta.timelineSprite;
  meta.hlsPurged = true;
  await prisma.mediaObject.update({
    where: { id: m.id },
    data: { metadata: meta as Prisma.InputJsonValue },
  });
  return true;
}

/** Allège les vidéos rattachées à ces versions, dans la limite du budget. */
async function purgeDerivedForVersions(versionIds: number[], budget: number): Promise<number> {
  let purged = 0;
  for (const ids of chunk(versionIds, PURGE_VERSION_IN_BATCH)) {
    if (purged >= budget) break;
    const media = await prisma.mediaObject.findMany({
      where: { versionId: { in: ids }, kind: 'VIDEO', deletedAt: null },
      select: { id: true, metadata: true },
      // Ordre stable : sans lui, un budget épuisé laisserait un reliquat différent à chaque
      // passe et la purge pourrait tourner sans jamais finir le même bout de travail.
      orderBy: { id: 'asc' },
    });
    for (const m of media) {
      if (purged >= budget) break;
      if (await purgeOneMedia(m)) purged += 1;
    }
  }
  return purged;
}

/**
 * Exécute la purge (idempotente). Renvoie le nombre de médias allégés.
 *
 * Le balayage est fait parent par parent et par lots : à configuration égale, l'ensemble
 * des médias allégés est identique à celui de la version « tout en mémoire » (cf. le test
 * d'équivalence), seul le chemin pour y arriver est borné.
 */
export async function purgeObsoleteDerived(
  maxItems: number = DERIVED_PURGE_MAX_ITEMS,
): Promise<{ purged: number }> {
  const cfg = await getDerivedPurgeConfig();
  if (!cfg.enabled) return { purged: 0 };

  let purged = 0;
  let budget = Math.max(0, Math.trunc(maxItems));

  for (const parent of ['task', 'asset'] as const) {
    let after: number | undefined;
    while (budget > 0) {
      const parents = await parentIdsWithLiveVersions(parent, after);
      if (parents.length === 0) break;
      after = parents[parents.length - 1];
      const versions = await prisma.version.findMany({
        // `taskId: null` côté asset : une version portant une tâche est groupée par tâche
        // (priorité de `selectObsoleteVersionIds`) — sans ce filtre elle serait comptée deux fois.
        where:
          parent === 'task'
            ? { deletedAt: null, taskId: { in: parents } }
            : { deletedAt: null, taskId: null, assetId: { in: parents } },
        select: { id: true, taskId: true, assetId: true },
      });
      const obsolete = selectObsoleteVersionIds(versions, cfg.keepVersions);
      if (obsolete.length > 0) {
        const done = await purgeDerivedForVersions(obsolete, budget);
        purged += done;
        budget -= done;
      }
      if (parents.length < PURGE_PARENT_BATCH) break;
    }
  }

  if (purged > 0) logger.info(`[derivedPurge] ${purged} média(s) allégé(s) (HLS + sprite retirés)`);
  return { purged };
}

export const __testing = { sanitize, FALLBACK, PURGE_PARENT_BATCH, PURGE_VERSION_IN_BATCH };
