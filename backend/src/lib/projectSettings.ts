// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { prisma } from './prisma';
import { burninConfigSchema, type BurninConfig } from './burnin';
import { badRequest } from './errors';

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
 * Critère : un groupe QUANTIFIÉ dont le corps contient lui-même un quantificateur ou une
 * alternance. C'est la forme des explosions exponentielles (`(a+)+`, `(a*)*`, `(a|a)+`,
 * `(a|b|ab)*`, `(a{1,3})+`) ; une convention de nommage légitime n'en a jamais besoin.
 *
 * L'analyse se fait par parcours à parenthèses équilibrées, et non par une regex sur la
 * regex : une expression régulière ne sait pas compter les parenthèses, et toute tentative
 * précédente laissait donc passer les groupes imbriqués — `((a+))+` reste exponentiel
 * (mesuré ici : 30 caractères = ~13 s de boucle d'événements bloquée).
 */
export function isCatastrophicPattern(pattern: string): boolean {
  const starts: number[] = [];
  let inClass = false;

  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '\\') {
      i++; // échappement : le caractère suivant est littéral
      continue;
    }
    // À l'intérieur d'une classe [...], `(`, `|` et les quantificateurs sont littéraux.
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') {
      inClass = true;
      continue;
    }
    if (c === '(') {
      starts.push(i);
      continue;
    }
    if (c !== ')') continue;

    const open = starts.pop();
    if (open === undefined) continue; // parenthèse orpheline : `new RegExp` refusera
    // Le groupe est-il quantifié ? (`*`, `+`, ou `{n,}` — `{n}` et `{n,m}` sont bornés)
    const after = pattern.slice(i + 1);
    const quantified = /^[*+]/.test(after) || /^\{\d+,\}/.test(after);
    if (!quantified) continue;
    // …et son corps contient-il de quoi produire plusieurs analyses de la même entrée ?
    if (hasAmbiguityInside(pattern.slice(open + 1, i))) return true;
  }
  return false;
}

/** Le corps d'un groupe porte-t-il un quantificateur ou une alternance (hors classe) ? */
function hasAmbiguityInside(body: string): boolean {
  let inClass = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') {
      inClass = true;
      continue;
    }
    if (c === '*' || c === '+' || c === '|' || c === '{') return true;
  }
  return false;
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

/** Liste de départements reçue : ne garde que les entrées complètes. */
function sanitizeDepartments(raw: unknown): Department[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.filter((d): d is Department => !!d && typeof d.key === 'string' && typeof d.name === 'string');
}

/** Nomenclature reçue, champ par champ, sur un socle. */
function sanitizeNomenclature(raw: unknown, base: Nomenclature): Nomenclature {
  const n = (raw ?? {}) as Partial<Nomenclature>;
  return {
    sequencePrefix: typeof n.sequencePrefix === 'string' ? n.sequencePrefix : base.sequencePrefix,
    shotPrefix: typeof n.shotPrefix === 'string' ? n.shotPrefix : base.shotPrefix,
    padding: Number.isFinite(n.padding) ? Math.min(Math.max(Number(n.padding), 1), 8) : base.padding,
    step: Number.isFinite(n.step) ? Math.max(Number(n.step), 1) : base.step,
  };
}

function sanitize(raw: unknown, base: ProjectSettings): ProjectSettings {
  const o = (raw ?? {}) as Partial<ProjectSettings>;
  const departments = sanitizeDepartments(o.departments) ?? base.departments;
  const nomenclature = sanitizeNomenclature(o.nomenclature, base.nomenclature);
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
  // Refus à l'ÉCRITURE, en plus du garde-fou à l'exécution : un motif explosif n'a alors
  // aucune chance d'atteindre le chemin d'upload, et le superviseur voit tout de suite que
  // sa convention est refusée — au lieu de la croire active alors qu'elle est neutralisée.
  if (pattern && isCatastrophicPattern(pattern))
    throw badRequest(
      'Naming pattern rejected: nested quantifier or alternation (the server could stall on it)',
      'NAMING_PATTERN_UNSAFE',
    );
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

/** Schémas Zod par section — partagés entre l'écriture complète (PUT) et le PATCH. */
const sectionSchemas = {
  departments: z.array(z.object({ key: z.string().min(1).max(40), name: z.string().min(1).max(80) })),
  nomenclature: z.object({
    sequencePrefix: z.string().max(16),
    shotPrefix: z.string().max(16),
    padding: z.number().int().min(1).max(8),
    step: z.number().int().min(1),
  }),
  naming: z.object({ pattern: z.string().max(200), mode: z.enum(['off', 'warn', 'reject']) }),
  resolution: resolutionSchema,
  framerate: z.number().min(FPS_MIN).max(FPS_MAX),
  burnin: burninConfigSchema,
  defaultLighting: z.object({
    hdriId: z.string().max(64).optional(),
    exposure: z.number().min(EXPOSURE_MIN).max(EXPOSURE_MAX),
    rotationDeg: z.number().min(ROTATION_MIN).max(ROTATION_MAX),
    showBackground: z.boolean(),
    groundShadow: z.boolean(),
  }),
  color: z.object({
    configId: z.string().max(120).optional(),
    display: z.string().max(120).optional(),
    view: z.string().max(120).optional(),
  }),
} as const;

/** Schéma Zod des réglages projet/studio complets (tous optionnels). */
export const projectSettingsSchema = z.object({
  departments: sectionSchemas.departments.optional(),
  nomenclature: sectionSchemas.nomenclature.optional(),
  naming: sectionSchemas.naming.optional(),
  resolution: sectionSchemas.resolution.optional(),
  framerate: sectionSchemas.framerate.optional(),
  burnin: sectionSchemas.burnin.optional(),
  defaultLighting: sectionSchemas.defaultLighting.optional(),
  color: sectionSchemas.color.optional(),
});

/**
 * Schéma Zod d'un PATCH de réglages projet : une section absente reste inchangée,
 * une section à `null` retourne à l'héritage studio. `.strict()` pour qu'une clé
 * inconnue soit refusée plutôt que silencieusement perdue.
 */
export const projectSettingsPatchSchema = z
  .object({
    departments: sectionSchemas.departments.nullable().optional(),
    nomenclature: sectionSchemas.nomenclature.nullable().optional(),
    naming: sectionSchemas.naming.nullable().optional(),
    resolution: sectionSchemas.resolution.nullable().optional(),
    framerate: sectionSchemas.framerate.nullable().optional(),
    burnin: sectionSchemas.burnin.nullable().optional(),
    defaultLighting: sectionSchemas.defaultLighting.nullable().optional(),
    color: sectionSchemas.color.nullable().optional(),
  })
  .strict();

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

/* ------------------------------------------------------------------------------------- *
 *  Override ≠ effectif
 *
 *  La même forme JSON servait aux deux : la lecture rendait l'effectif (fusionné avec les
 *  défauts studio) et l'écriture le réenregistrait tel quel dans `Project.settings`. Ouvrir
 *  l'onglet Réglages puis cliquer Enregistrer figeait donc la résolution, la cadence, la
 *  nomenclature, les burn-ins, l'éclairage et l'OCIO du studio dans le projet : changer
 *  ensuite un défaut studio n'avait plus aucun effet, sans que rien ne le signale.
 *
 *  Ce qui suit sépare les deux lectures et donne à l'écriture une granularité de SECTION :
 *  une section absente du JSON du projet est héritée, une section présente est surchargée,
 *  et un PATCH à `null` la rend à l'héritage.
 * ------------------------------------------------------------------------------------- */

/**
 * Sections d'un override projet — unité d'écriture du PATCH et d'affichage de l'héritage.
 * `resolution` et `framerate` restent distinctes : un projet peut livrer en 4K à la cadence
 * du studio.
 */
export const SETTINGS_SECTIONS = [
  'resolution',
  'framerate',
  'nomenclature',
  'departments',
  'naming',
  'defaultLighting',
  'color',
  'burnin',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Ce que le projet stocke réellement : les seules sections qu'il surcharge. */
export type ProjectSettingsOverride = Partial<Pick<ProjectSettings, SettingsSection>>;

/** Corps d'un PATCH : section absente = inchangée, section `null` = retour à l'héritage. */
export type ProjectSettingsPatch = { [K in SettingsSection]?: ProjectSettings[K] | null };

const SECTION_SET = new Set<string>(SETTINGS_SECTIONS);

/** Une valeur de section est-elle réellement fournie (présente et non nulle) ? */
function provided(o: Record<string, unknown>, key: string): boolean {
  return key in o && o[key] !== undefined && o[key] !== null;
}

/**
 * Nettoie un override : SEULES les sections présentes ressortent, sans jamais être
 * complétées par les défauts studio. C'est la différence avec `sanitize`, qui rend un
 * réglage complet. Le socle studio ne sert ici qu'à borner les champs manquants d'une
 * section partiellement remplie.
 */
export function sanitizeOverride(raw: unknown, studio: ProjectSettings): ProjectSettingsOverride {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: ProjectSettingsOverride = {};

  const departments = provided(o, 'departments') ? sanitizeDepartments(o.departments) : undefined;
  if (departments) out.departments = departments;
  if (provided(o, 'nomenclature'))
    out.nomenclature = sanitizeNomenclature(o.nomenclature, studio.nomenclature);
  if (provided(o, 'naming')) out.naming = sanitizeNaming(o.naming, studio.naming);
  if (provided(o, 'resolution')) out.resolution = sanitizeResolution(o.resolution, studio.resolution);
  if (provided(o, 'framerate') && Number.isFinite(o.framerate)) out.framerate = clampFps(Number(o.framerate));
  const burnin = provided(o, 'burnin') ? sanitizeBurninOverride(o.burnin) : undefined;
  if (burnin) out.burnin = burnin;
  const lighting = provided(o, 'defaultLighting') ? sanitizeLighting(o.defaultLighting) : undefined;
  if (lighting) out.defaultLighting = lighting;
  const color = provided(o, 'color') ? sanitizeColor(o.color) : undefined;
  if (color) out.color = color;
  return out;
}

/** Sections effectivement surchargées par le projet (le reste est hérité du studio). */
export function overriddenSections(override: ProjectSettingsOverride): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) => override[section] !== undefined);
}

/**
 * Clés du JSON stocké qui ne sont pas des sections de réglages (`isTemplate`, notamment).
 * Elles survivent à toute écriture : l'ancien PUT les effaçait, le schéma Zod n'en
 * connaissant aucune.
 */
function extraKeys(stored: unknown): Record<string, unknown> {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (!SECTION_SET.has(key)) out[key] = value;
  }
  return out;
}

/**
 * Applique un PATCH section par section sur le JSON stocké d'un projet.
 * Section absente : inchangée · section `null` : retirée (retour à l'héritage) ·
 * section fournie : remplacée par sa version nettoyée.
 */
export function patchStoredSettings(
  stored: unknown,
  patch: ProjectSettingsPatch,
  studio: ProjectSettings,
): Record<string, unknown> {
  const current = sanitizeOverride(stored, studio) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...current };
  for (const section of SETTINGS_SECTIONS) {
    if (!(section in patch)) continue;
    const value = patch[section];
    if (value === null || value === undefined) {
      delete next[section];
      continue;
    }
    const clean = sanitizeOverride({ [section]: value }, studio) as Record<string, unknown>;
    if (clean[section] === undefined) delete next[section];
    else next[section] = clean[section];
  }
  return { ...extraKeys(stored), ...next };
}

/** Remplace l'override entier (PUT) : seules les sections envoyées restent surchargées. */
export function replaceStoredSettings(
  stored: unknown,
  body: unknown,
  studio: ProjectSettings,
): Record<string, unknown> {
  return { ...extraKeys(stored), ...sanitizeOverride(body, studio) };
}

/** Override d'un projet tel qu'il est stocké, nettoyé (sans complétion studio). */
export async function resolveProjectOverride(projectSettings: unknown): Promise<ProjectSettingsOverride> {
  const studio = await getStudioProjectDefaults();
  return sanitizeOverride(projectSettings, studio);
}

/**
 * Réglages effectifs d'un projet à partir de son id (charge la colonne settings).
 *
 * Les départements ne viennent plus du JSON mais de la table `Department` (B1) : c'est
 * elle qui fait foi depuis que ce sont des entités. Tout le reste du pipe
 * (`lib/pipelineOrder.ts`, l'élection de la dernière version, les regroupements
 * d'affichage) continue de lire `settings.departments` sans savoir d'où ils sortent.
 * Le JSON reste lu en repli, le temps qu'une base non migrée se rattrape.
 */
export async function resolveProjectSettingsById(projectId: number): Promise<ProjectSettings> {
  const [project, departments] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { settings: true } }),
    listDepartmentsForProject(projectId),
  ]);
  const base = await resolveProjectSettings(project?.settings ?? {});
  return departments.length > 0 ? { ...base, departments } : base;
}

/** Départements du projet, sinon ceux du studio. Ordre du pipe, amont → aval. */
async function listDepartmentsForProject(projectId: number): Promise<Department[]> {
  const orderBy = [{ order: 'asc' as const }, { key: 'asc' as const }];
  const own = await prisma.department.findMany({
    where: { projectId, deletedAt: null },
    select: { key: true, name: true },
    orderBy,
  });
  if (own.length > 0) return own;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { studioId: true } });
  if (!project) return [];
  return prisma.department.findMany({
    where: { studioId: project.studioId, projectId: null, deletedAt: null },
    select: { key: true, name: true },
    orderBy,
  });
}
