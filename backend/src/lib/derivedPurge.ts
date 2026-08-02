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

/** Exécute la purge (idempotente). Renvoie le nombre de médias allégés. */
export async function purgeObsoleteDerived(): Promise<{ purged: number }> {
  const cfg = await getDerivedPurgeConfig();
  if (!cfg.enabled) return { purged: 0 };

  const versions = await prisma.version.findMany({
    where: { deletedAt: null },
    select: { id: true, taskId: true, assetId: true },
  });
  const obsolete = selectObsoleteVersionIds(versions, cfg.keepVersions);
  if (obsolete.length === 0) return { purged: 0 };

  const media = await prisma.mediaObject.findMany({
    where: { versionId: { in: obsolete }, kind: 'VIDEO', deletedAt: null },
    select: { id: true, metadata: true },
  });
  let purged = 0;
  for (const m of media) {
    const meta = { ...((m.metadata ?? {}) as Record<string, unknown>) };
    if (meta.hlsPurged === true || (!meta.hls && !meta.timelineSprite)) continue;
    await storage.deletePrefix(`derived/${m.id}/hls/`).catch(() => undefined);
    const sprite = meta.timelineSprite as { key?: string } | undefined;
    if (sprite?.key) await storage.deleteObject(sprite.key).catch(() => undefined);
    delete meta.hls;
    delete meta.timelineSprite;
    meta.hlsPurged = true;
    await prisma.mediaObject.update({
      where: { id: m.id },
      data: { metadata: meta as Prisma.InputJsonValue },
    });
    purged += 1;
  }
  if (purged > 0) logger.info(`[derivedPurge] ${purged} média(s) allégé(s) (HLS + sprite retirés)`);
  return { purged };
}

export const __testing = { sanitize, FALLBACK };
