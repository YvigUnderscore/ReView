import { z } from 'zod';
import { prisma } from './prisma';

/**
 * Configuration de transcodage vidéo (contexte Vidéo admin, Phase 22) — lue par le worker
 * FFmpeg (Phase 23, HLS adaptatif). Stockée dans `Setting.transcode_config` (JSON).
 * Quand `enabled` est faux, le worker retombe sur un proxy MP4 unique (comportement legacy).
 */

export interface TranscodeRendition {
  height: number; // hauteur cible (px)
  videoBitrateK: number; // débit vidéo cible (kbps)
}

export interface TranscodeConfig {
  enabled: boolean; // HLS adaptatif multi-rendition
  crf: number; // qualité x264 (plus bas = meilleur)
  preset: string; // preset x264
  audioBitrateK: number; // débit audio (kbps)
  maxHeight: number; // plafond de résolution
  ladder: TranscodeRendition[]; // échelle de qualités
  /** Scene detection FFmpeg (34.H, opt-in : une passe d'analyse en plus par vidéo) —
   *  pose des marqueurs de timeline « Plan n » aux coupes détectées. */
  sceneDetection: boolean;
}

const TRANSCODE_KEY = 'transcode_config';
export const X264_PRESETS = [
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
] as const;

const FALLBACK: TranscodeConfig = {
  enabled: true,
  crf: 23,
  preset: 'veryfast',
  audioBitrateK: 128,
  maxHeight: 2160,
  ladder: [
    { height: 360, videoBitrateK: 800 },
    { height: 720, videoBitrateK: 2500 },
    { height: 1080, videoBitrateK: 5000 },
    { height: 2160, videoBitrateK: 14000 },
  ],
  sceneDetection: false,
};

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

function sanitize(raw: unknown, base: TranscodeConfig): TranscodeConfig {
  const o = (raw ?? {}) as Partial<TranscodeConfig>;
  const ladder = Array.isArray(o.ladder)
    ? o.ladder
        .filter(
          (r): r is TranscodeRendition =>
            !!r && Number.isFinite(r.height) && Number.isFinite(r.videoBitrateK),
        )
        .map((r) => ({
          height: clamp(Math.round(r.height), 144, 4320),
          videoBitrateK: clamp(Math.round(r.videoBitrateK), 100, 100000),
        }))
        .sort((a, b) => a.height - b.height)
    : base.ladder;
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : base.enabled,
    crf: Number.isFinite(o.crf) ? clamp(Math.round(Number(o.crf)), 0, 51) : base.crf,
    preset:
      typeof o.preset === 'string' && (X264_PRESETS as readonly string[]).includes(o.preset)
        ? o.preset
        : base.preset,
    audioBitrateK: Number.isFinite(o.audioBitrateK)
      ? clamp(Math.round(Number(o.audioBitrateK)), 32, 512)
      : base.audioBitrateK,
    maxHeight: Number.isFinite(o.maxHeight)
      ? clamp(Math.round(Number(o.maxHeight)), 144, 4320)
      : base.maxHeight,
    ladder: ladder.length > 0 ? ladder : base.ladder,
    sceneDetection: typeof o.sceneDetection === 'boolean' ? o.sceneDetection : base.sceneDetection,
  };
}

/**
 * Renditions effectives pour une source de hauteur donnée : on garde les paliers de l'échelle
 * dont la hauteur ≤ min(source, plafond), et on ajoute un palier « source » si aucun ne l'atteint
 * (pour ne jamais up-scaler mais toujours proposer au moins une qualité). Pur, testable.
 */
export function selectRenditions(config: TranscodeConfig, sourceHeight: number): TranscodeRendition[] {
  const ceil = Math.min(sourceHeight, config.maxHeight);
  const kept = config.ladder.filter((r) => r.height <= ceil);
  if (kept.length === 0) {
    // Source plus petite que le plus petit palier : une seule rendition à la hauteur source.
    const smallest = config.ladder[0];
    return [{ height: ceil, videoBitrateK: smallest?.videoBitrateK ?? 800 }];
  }
  return kept;
}

/** Config effective (Setting.transcode_config fusionné avec le repli interne). */
export async function getTranscodeConfig(): Promise<TranscodeConfig> {
  const row = await prisma.setting.findUnique({ where: { key: TRANSCODE_KEY } });
  if (!row) return FALLBACK;
  try {
    return sanitize(JSON.parse(row.value), FALLBACK);
  } catch {
    return FALLBACK;
  }
}

/** Enregistre la config de transcodage (validée/bornée). */
export async function setTranscodeConfig(value: unknown): Promise<TranscodeConfig> {
  const clean = sanitize(value, FALLBACK);
  await prisma.setting.upsert({
    where: { key: TRANSCODE_KEY },
    update: { value: JSON.stringify(clean) },
    create: { key: TRANSCODE_KEY, value: JSON.stringify(clean) },
  });
  return clean;
}

export const transcodeConfigSchema = z.object({
  enabled: z.boolean().optional(),
  crf: z.number().int().min(0).max(51).optional(),
  preset: z.enum(X264_PRESETS).optional(),
  audioBitrateK: z.number().int().min(32).max(512).optional(),
  maxHeight: z.number().int().min(144).max(4320).optional(),
  ladder: z
    .array(
      z.object({
        height: z.number().int().min(144).max(4320),
        videoBitrateK: z.number().int().min(100).max(100000),
      }),
    )
    .optional(),
  sceneDetection: z.boolean().optional(),
});
