import { z } from 'zod';
import { prisma } from './prisma';
import { burninConfigSchema, type BurninConfig } from './burnin';

/**
 * Réglages projet : départements + nomenclature + pipeline (résolution/framerate).
 *
 * Deux niveaux :
 *  - défauts studio (table Setting, clé `project_defaults`, JSON) — appliqués à la
 *    création d'un projet et comme valeurs de repli.
 *  - override par projet (colonne Project.settings, JSON) — prioritaire si présent.
 *
 * Le pipeline (résolution/framerate) est en plus hérité au niveau séquence/shot via
 * leur colonne `settings` (override partiel), résolu par `resolveEntitySettings`.
 * Les start/end frames restent sur les colonnes dédiées (Project.startFrame,
 * Shot.startFrame/endFrame). Pas de colorspace (décision Phase 18).
 */

export interface Department {
  key: string; // identifiant court stable (ex: ANIM)
  name: string; // libellé affiché (ex: Animation)
}

export interface Nomenclature {
  sequencePrefix: string; // ex: SQ
  shotPrefix: string; // ex: SH
  padding: number; // nombre de chiffres (ex: 3 → 010)
  step: number; // pas d'incrément (ex: 10 → 010, 020, 030)
}

export interface Resolution {
  width: number;
  height: number;
}

/** Réglages pipeline effectifs (après héritage) d'une entité. */
export interface PipelineSettings {
  resolution: Resolution;
  framerate: number;
}

export interface ProjectSettings extends PipelineSettings {
  departments: Department[];
  nomenclature: Nomenclature;
  /** Override partiel des burn-ins (35.A) — résolu champ par champ sur le template studio. */
  burnin?: Partial<BurninConfig>;
}

export const STUDIO_DEFAULTS_KEY = 'project_defaults';

// Bornes de sécurité (partagées par le sanitize et les schémas Zod).
const DIM_MIN = 1;
const DIM_MAX = 16384;
const FPS_MIN = 1;
const FPS_MAX = 240;

const clampDim = (v: number) => Math.min(Math.max(Math.round(v), DIM_MIN), DIM_MAX);
const clampFps = (v: number) => Math.min(Math.max(v, FPS_MIN), FPS_MAX);

const FALLBACK: ProjectSettings = {
  departments: [
    { key: 'MODELING', name: 'Modeling' },
    { key: 'RIGGING', name: 'Rigging' },
    { key: 'ANIMATION', name: 'Animation' },
    { key: 'FX', name: 'FX' },
    { key: 'LIGHTING', name: 'Lighting' },
    { key: 'COMPOSITING', name: 'Compositing' },
    { key: 'LOOKDEV', name: 'Look Dev' },
    { key: 'LAYOUT', name: 'Layout' },
  ],
  nomenclature: { sequencePrefix: 'SQ', shotPrefix: 'SH', padding: 3, step: 10 },
  resolution: { width: 1920, height: 1080 },
  framerate: 24,
};

function sanitizeResolution(raw: unknown, base: Resolution): Resolution {
  const o = (raw ?? {}) as Partial<Resolution>;
  return {
    width: Number.isFinite(o.width) ? clampDim(Number(o.width)) : base.width,
    height: Number.isFinite(o.height) ? clampDim(Number(o.height)) : base.height,
  };
}

function sanitize(raw: unknown, base: ProjectSettings): ProjectSettings {
  const o = (raw ?? {}) as Partial<ProjectSettings>;
  const departments = Array.isArray(o.departments)
    ? o.departments.filter(
        (d): d is Department => !!d && typeof d.key === 'string' && typeof d.name === 'string',
      )
    : base.departments;
  const n = (o.nomenclature ?? {}) as Partial<Nomenclature>;
  const nomenclature: Nomenclature = {
    sequencePrefix:
      typeof n.sequencePrefix === 'string' ? n.sequencePrefix : base.nomenclature.sequencePrefix,
    shotPrefix: typeof n.shotPrefix === 'string' ? n.shotPrefix : base.nomenclature.shotPrefix,
    padding: Number.isFinite(n.padding)
      ? Math.min(Math.max(Number(n.padding), 1), 8)
      : base.nomenclature.padding,
    step: Number.isFinite(n.step) ? Math.max(Number(n.step), 1) : base.nomenclature.step,
  };
  const resolution = sanitizeResolution(o.resolution, base.resolution);
  const framerate = Number.isFinite(o.framerate) ? clampFps(Number(o.framerate)) : base.framerate;
  // Burn-ins : override PARTIEL conservé tel quel (clés connues, types vérifiés) — la
  // résolution effective (fusion avec le template studio) est faite par lib/burnin.
  const burnin = sanitizeBurninOverride(o.burnin) ?? base.burnin;
  return { departments, nomenclature, resolution, framerate, ...(burnin ? { burnin } : {}) };
}

/** Filtre un override burn-in partiel (clés/types connus uniquement), undefined si vide. */
function sanitizeBurninOverride(raw: unknown): Partial<BurninConfig> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const out: Partial<BurninConfig> = {};
  for (const k of ['enabled', 'showShot', 'showVersion', 'showTimecode', 'showLogo', 'slate'] as const) {
    if (typeof o[k] === 'boolean') out[k] = o[k];
  }
  if (typeof o.customText === 'string') out.customText = o.customText.slice(0, 120);
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Applique un override pipeline partiel (JSON d'une séquence/shot) par-dessus un socle.
 * Seuls les champs présents et valides sont pris en compte ; le reste hérite du parent.
 */
export function applyPipelineOverride(base: PipelineSettings, raw: unknown): PipelineSettings {
  const o = (raw ?? {}) as { resolution?: unknown; framerate?: unknown };
  const resolution =
    o.resolution && typeof o.resolution === 'object'
      ? sanitizeResolution(o.resolution, base.resolution)
      : base.resolution;
  const framerate = Number.isFinite(o.framerate) ? clampFps(Number(o.framerate)) : base.framerate;
  return { resolution, framerate };
}

/** Pipeline (résolution/framerate) extrait de réglages projet résolus. */
export function pipelineOf(settings: ProjectSettings): PipelineSettings {
  return { resolution: settings.resolution, framerate: settings.framerate };
}

/**
 * Réglages pipeline effectifs d'une entité après héritage projet→séquence→shot.
 * Chaque override (séquence puis shot) est un JSON partiel appliqué dans l'ordre.
 */
export function resolveEntitySettings(
  project: ProjectSettings,
  sequenceOverride?: unknown,
  shotOverride?: unknown,
): PipelineSettings {
  let pipeline = pipelineOf(project);
  if (sequenceOverride !== undefined && sequenceOverride !== null) {
    pipeline = applyPipelineOverride(pipeline, sequenceOverride);
  }
  if (shotOverride !== undefined && shotOverride !== null) {
    pipeline = applyPipelineOverride(pipeline, shotOverride);
  }
  return pipeline;
}

/** Schéma Zod d'une résolution (partagé routes). */
export const resolutionSchema = z.object({
  width: z.number().int().min(DIM_MIN).max(DIM_MAX),
  height: z.number().int().min(DIM_MIN).max(DIM_MAX),
});

/** Schéma Zod d'un override pipeline (séquence/shot) : champs optionnels. */
export const pipelineOverrideSchema = z
  .object({
    resolution: resolutionSchema.optional(),
    framerate: z.number().min(FPS_MIN).max(FPS_MAX).optional(),
  })
  .strict();

/** Schéma Zod des réglages projet/studio complets (tous optionnels). */
export const projectSettingsSchema = z.object({
  departments: z
    .array(z.object({ key: z.string().min(1).max(40), name: z.string().min(1).max(80) }))
    .optional(),
  nomenclature: z
    .object({
      sequencePrefix: z.string().max(16),
      shotPrefix: z.string().max(16),
      padding: z.number().int().min(1).max(8),
      step: z.number().int().min(1),
    })
    .optional(),
  resolution: resolutionSchema.optional(),
  framerate: z.number().min(FPS_MIN).max(FPS_MAX).optional(),
  burnin: burninConfigSchema.optional(),
});

/** Défauts studio (Setting.project_defaults), fusionnés avec le repli interne. */
export async function getStudioProjectDefaults(): Promise<ProjectSettings> {
  const row = await prisma.setting.findUnique({ where: { key: STUDIO_DEFAULTS_KEY } });
  if (!row) return FALLBACK;
  try {
    return sanitize(JSON.parse(row.value), FALLBACK);
  } catch {
    return FALLBACK;
  }
}

/** Enregistre les défauts studio. */
export async function setStudioProjectDefaults(value: unknown): Promise<ProjectSettings> {
  const clean = sanitize(value, FALLBACK);
  await prisma.setting.upsert({
    where: { key: STUDIO_DEFAULTS_KEY },
    update: { value: JSON.stringify(clean) },
    create: { key: STUDIO_DEFAULTS_KEY, value: JSON.stringify(clean) },
  });
  return clean;
}

/** Réglages effectifs d'un projet : override projet par-dessus les défauts studio. */
export async function resolveProjectSettings(projectSettings: unknown): Promise<ProjectSettings> {
  const studio = await getStudioProjectDefaults();
  return sanitize(projectSettings, studio);
}
