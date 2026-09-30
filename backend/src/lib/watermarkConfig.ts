// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { prisma } from './prisma';

/**
 * Watermark dynamique au nom du spectateur (35.B) — overlay client dissuasif.
 * `internal` : viewers de review authentifiés (identité du compte) ; `shares` : page
 * client publique (label du lien / nom invité). Stocké dans `Setting.watermark_config`.
 */

export interface WatermarkConfig {
  internal: boolean;
  shares: boolean;
  opacity: number; // 0.02 → 0.4
}

const WATERMARK_KEY = 'watermark_config';

const FALLBACK: WatermarkConfig = { internal: false, shares: true, opacity: 0.08 };

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

function sanitize(raw: unknown, base: WatermarkConfig): WatermarkConfig {
  const o = (raw ?? {}) as Partial<WatermarkConfig>;
  return {
    internal: typeof o.internal === 'boolean' ? o.internal : base.internal,
    shares: typeof o.shares === 'boolean' ? o.shares : base.shares,
    opacity: Number.isFinite(o.opacity) ? clamp(Number(o.opacity), 0.02, 0.4) : base.opacity,
  };
}

/** Config effective (Setting fusionné avec le repli interne). */
export async function getWatermarkConfig(): Promise<WatermarkConfig> {
  const row = await prisma.setting.findUnique({ where: { key: WATERMARK_KEY } });
  if (!row) return FALLBACK;
  try {
    return sanitize(JSON.parse(row.value), FALLBACK);
  } catch {
    return FALLBACK;
  }
}

/** Enregistre la config (validée/bornée). */
export async function setWatermarkConfig(value: unknown): Promise<WatermarkConfig> {
  const clean = sanitize(value, FALLBACK);
  await prisma.setting.upsert({
    where: { key: WATERMARK_KEY },
    update: { value: JSON.stringify(clean) },
    create: { key: WATERMARK_KEY, value: JSON.stringify(clean) },
  });
  return clean;
}

export const watermarkConfigSchema = z.object({
  internal: z.boolean().optional(),
  shares: z.boolean().optional(),
  opacity: z.number().min(0.02).max(0.4).optional(),
});

export const __testing = { sanitize, FALLBACK };
