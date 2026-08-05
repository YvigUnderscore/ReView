// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

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

export type NamingMode = 'off' | 'warn' | 'reject';

/** Convention de nommage à l'upload (38.C) : regex + politique d'application. */
export interface NamingRule {
  pattern: string; // regex JS (chaîne) ; vide = pas de contrainte
  mode: NamingMode; // off : ignoré · warn : avertit · reject : refuse l'upload
}

/**
 * Éclairage HDRI par défaut d'un projet (39.F) — miroir de `LightingConfig` (frontend).
 * Rejoué à l'ouverture d'un média 3D qui n'a pas d'éclairage propre (`splatPresentation.lighting`).
 * `hdriId` référence la bibliothèque instance ; les autres champs ont des défauts neutres.
 */
export interface LightingDefault {
  hdriId?: string;
  exposure: number;
  rotationDeg: number;
  showBackground: boolean;
  groundShadow: boolean;
}

/**
 * Gestion de couleur du projet (39.B) : config OCIO + display/view choisis. `configId` référence une
 * config installée (`OcioService`) ; vide = config par défaut du studio. Sans display/view, le viewer
 * garde son rendu actuel (la transformation OCIO pixel-exacte est un lot ultérieur).
 */
export interface ColorSettings {
  configId?: string;
  display?: string;
  view?: string;
}

export interface ProjectSettings extends PipelineSettings {
  departments: Department[];
  nomenclature: Nomenclature;
  /** Convention de nommage des fichiers à l'upload (38.C). */
  naming: NamingRule;
  /** Override partiel des burn-ins (35.A) — résolu champ par champ sur le template studio. */
  burnin?: Partial<BurninConfig>;
  /** Éclairage HDRI par défaut du viewer 3D (39.F), hérité studio→projet. */
  defaultLighting?: LightingDefault;
  /** Gestion de couleur OCIO du projet (39.B) : config + display/view. */
  color?: ColorSettings;
}

/**
 * Un motif expose-t-il au « catastrophic backtracking » ?
 *
 * La convention de nommage est une regex saisie par un gestionnaire de projet, puis exécutée
 * sur le nom de CHAQUE fichier téléversé. Node n'offre aucun délai maximal sur une regex :
 * un motif comme `(a+)+$` confronté à un nom bien choisi bloque la boucle d'événements —
 * donc toute l'API, pour tout le studio, sur une seule requête.
 *
 * Heuristique volontairement grossière : un groupe qui contient déjà un quantificateur et qui
 * est lui-même quantifié. C'est la forme des explosions exponentielles classiques
 * (`(a+)+`, `(a*)*`, `(a|a)+`, `(a{1,3})+`) ; une convention de nommage légitime n'en a
 * jamais besoin.
 */
export function isCatastrophicPattern(pattern: string): boolean {
  // Groupe (...) dont le corps porte un quantificateur, suivi d'un quantificateur.
  const nestedQuantifier = /\((?:[^()\\]|\\.)*[*+?}](?:[^()\\]|\\.)*\)\s*[*+]|\)\s*\{\d+,\}/;
  // Alternance de branches identiques dans un groupe quantifié : (a|a)*
  const quantifiedAlternation = /\((?:[^()|\\]|\\.)+\|(?:[^()|\\]|\\.)+\)\s*[*+]/;
  return nestedQuantifier.test(pattern) || quantifiedAlternation.test(pattern);
}

/**
 * Teste un nom de fichier contre la convention du projet (38.C). Une regex invalide, un motif
 * dangereux, ou un mode `off`/motif vide n'entravent jamais l'upload (`pass: true`,
 * `mode: 'off'`) — la convention est une aide à la rigueur, pas un verrou de sécurité.
 */
export function checkNaming(
  filename: string,
  naming: NamingRule | undefined,
): { pass: boolean; mode: NamingMode } {
  if (!naming || naming.mode === 'off' || !naming.pattern) return { pass: true, mode: 'off' };
  if (isCatastrophicPattern(naming.pattern)) return { pass: true, mode: 'off' };
  let re: RegExp;
  try {
    re = new RegExp(naming.pattern);
  } catch {
    return { pass: true, mode: 'off' };
  }
  return { pass: re.test(filename), mode: naming.mode };
}

export const STUDIO_DEFAULTS_KEY = 'project_defaults';

// Bornes de sécurité (partagées par le sanitize et les schémas Zod).
const DIM_MIN = 1;
const DIM_MAX = 16384;
const FPS_MIN = 1;
const FPS_MAX = 240;

const EXPOSURE_MIN = 0;
const EXPOSURE_MAX = 10;
const ROTATION_MIN = -180;
const ROTATION_MAX = 180;

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
  naming: { pattern: '', mode: 'off' },
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
  const naming = sanitizeNaming(o.naming, base.naming);
  // Burn-ins : override PARTIEL conservé tel quel (clés connues, types vérifiés) — la
  // résolution effective (fusion avec le template studio) est faite par lib/burnin.
  const burnin = sanitizeBurninOverride(o.burnin) ?? base.burnin;
  // Éclairage par défaut (39.F) : absent → hérite du socle ; présent → nettoyé/borné.
  const defaultLighting = 'defaultLighting' in o ? sanitizeLighting(o.defaultLighting) : base.defaultLighting;
  // Couleur OCIO (39.B) : absent → hérite ; présent → nettoyé.
  const color = 'color' in o ? sanitizeColor(o.color) : base.color;
  return {
    departments,
    nomenclature,
    naming,
    resolution,
    framerate,
    ...(burnin ? { burnin } : {}),
    ...(defaultLighting ? { defaultLighting } : {}),
    ...(color ? { color } : {}),
  };
}

/** Nettoie les réglages couleur (39.B) : chaînes bornées, undefined si vide. */
function sanitizeColor(raw: unknown): ColorSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Partial<ColorSettings>;
  const str = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 120) : undefined);
  const out: ColorSettings = {};
  const configId = str(o.configId);
  const display = str(o.display);
  const view = str(o.view);
  if (configId) out.configId = configId;
  if (display) out.display = display;
  if (view) out.view = view;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Nettoie l'éclairage par défaut (39.F) : bornes exposition/rotation, hdriId string, undefined si vide. */
function sanitizeLighting(raw: unknown): LightingDefault | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Partial<LightingDefault>;
  const hdriId = typeof o.hdriId === 'string' && o.hdriId ? o.hdriId.slice(0, 64) : undefined;
  const exposure = Number.isFinite(o.exposure)
    ? Math.min(Math.max(Number(o.exposure), EXPOSURE_MIN), EXPOSURE_MAX)
    : 1;
  const rotationDeg = Number.isFinite(o.rotationDeg)
    ? Math.min(Math.max(Number(o.rotationDeg), ROTATION_MIN), ROTATION_MAX)
    : 0;
  return {
    ...(hdriId ? { hdriId } : {}),
    exposure,
    rotationDeg,
    showBackground: o.showBackground === true,
    groundShadow: o.groundShadow === true,
  };
}

/** Nettoie la règle de nommage (pattern borné, mode dans l'ensemble autorisé). */
function sanitizeNaming(raw: unknown, base: NamingRule): NamingRule {
  const o = (raw ?? {}) as Partial<NamingRule>;
  const mode: NamingMode = o.mode === 'warn' || o.mode === 'reject' || o.mode === 'off' ? o.mode : base.mode;
  const pattern = typeof o.pattern === 'string' ? o.pattern.slice(0, 200) : base.pattern;
  return { pattern, mode };
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
  naming: z.object({ pattern: z.string().max(200), mode: z.enum(['off', 'warn', 'reject']) }).optional(),
  resolution: resolutionSchema.optional(),
  framerate: z.number().min(FPS_MIN).max(FPS_MAX).optional(),
  burnin: burninConfigSchema.optional(),
  defaultLighting: z
    .object({
      hdriId: z.string().max(64).optional(),
      exposure: z.number().min(EXPOSURE_MIN).max(EXPOSURE_MAX),
      rotationDeg: z.number().min(ROTATION_MIN).max(ROTATION_MAX),
      showBackground: z.boolean(),
      groundShadow: z.boolean(),
    })
    .optional(),
  color: z
    .object({
      configId: z.string().max(120).optional(),
      display: z.string().max(120).optional(),
      view: z.string().max(120).optional(),
    })
    .optional(),
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

/** Réglages effectifs d'un projet à partir de son id (charge la colonne settings). */
export async function resolveProjectSettingsById(projectId: number): Promise<ProjectSettings> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { settings: true },
  });
  return resolveProjectSettings(project?.settings ?? {});
}
