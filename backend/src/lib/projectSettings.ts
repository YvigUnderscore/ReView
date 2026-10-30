// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { prisma } from './prisma';
import { burninConfigSchema, type BurninConfig } from './burnin';
import { badRequest } from './errors';

/**
 * Project settings: departments + naming convention + pipeline (resolution/framerate).
 *
 * Two levels:
 *  - studio defaults (Setting table, key `project_defaults`, JSON) — applied when a project is created and as fallback values.
 *  - per-project override (Project.settings column, JSON) — takes precedence when present.
 *
 * The pipeline (resolution/framerate) is also inherited at sequence/shot level through their `settings` column (partial override),
 * resolved by `resolveEntitySettings`. The start/end frames remain on the dedicated columns (Project.startFrame, Shot.startFrame/endFrame).
 * No colorspace (Phase 18 decision).
 */

export interface Department {
  key: string; // short stable identifier (e.g. ANIM)
  name: string; // display label (e.g. Animation)
}

export interface Nomenclature {
  sequencePrefix: string; // e.g. SQ
  shotPrefix: string; // e.g. SH
  padding: number; // number of digits (e.g. 3 → 010)
  step: number; // increment step (e.g. 10 → 010, 020, 030)
}

export interface Resolution {
  width: number;
  height: number;
}

/** Effective pipeline settings (after inheritance) of an entity. */
export interface PipelineSettings {
  resolution: Resolution;
  framerate: number;
}

export type NamingMode = 'off' | 'warn' | 'reject';

/** Naming convention on upload (38.C): regex + enforcement policy. */
export interface NamingRule {
  pattern: string; // JS regex (string); empty = no constraint
  mode: NamingMode; // off: ignored · warn: warns · reject: refuses the upload
}

/**
 * What the project requires when someone is tagged as a ReViewer of a media.
 *
 * Tagging without saying what to look at only saves time for the tagger: the recipient opens the delivery without knowing whether
 * light, timing or the match is expected. A studio can therefore make the instruction mandatory — and give it a floor, without which
 * "ok" and "see" satisfy the rule while teaching nothing.
 *
 * The floor applies to **every written note**, even when it is not mandatory: an optional two-character instruction is not a short
 * instruction, it is an empty one that took the place of an empty field.
 */
export interface ReviewRequestRule {
  /** Is tagging someone without an instruction refused? */
  requireNote: boolean;
  /** Minimum length of a written instruction, in characters. */
  minNoteLength: number;
}

/**
 * Default HDRI lighting of a project (39.F) — mirror of `LightingConfig` (frontend).
 * Replayed when opening a 3D media that has no lighting of its own (`splatPresentation.lighting`).
 * `hdriId` references the instance library; the other fields have neutral defaults.
 */
export interface LightingDefault {
  hdriId?: string;
  exposure: number;
  rotationDeg: number;
  showBackground: boolean;
  groundShadow: boolean;
}

/**
 * Project colour management (39.B): OCIO config + chosen display/view. `configId` references an installed config (`OcioService`);
 * empty = the studio's default config. Without a display/view, the viewer keeps its current rendering (the pixel-exact OCIO transform
 * is a later batch).
 */
export interface ColorSettings {
  configId?: string;
  display?: string;
  view?: string;
}

export interface ProjectSettings extends PipelineSettings {
  departments: Department[];
  nomenclature: Nomenclature;
  /** File naming convention applied on upload (38.C). */
  naming: NamingRule;
  /** Instruction required from a tagged ReViewer on a media. */
  reviewRequest: ReviewRequestRule;
  /** Partial burn-in override (35.A) — resolved field by field on the studio template. */
  burnin?: Partial<BurninConfig>;
  /** Default HDRI lighting of the 3D viewer (39.F), inherited studio → project. */
  defaultLighting?: LightingDefault;
  /** Project OCIO colour management (39.B): config + display/view. */
  color?: ColorSettings;
}

/**
 * Does a pattern expose itself to "catastrophic backtracking"?
 *
 * The naming convention is a regex typed by a project manager, then executed on the name of EVERY uploaded file. Node offers no maximum
 * delay on a regex: a pattern such as `(a+)+$` confronted with a well-chosen name blocks the event loop — hence the whole API, for the
 * whole studio, on a single request.
 *
 * Criterion: a QUANTIFIED group whose body itself contains a quantifier or an alternation. This is the shape of exponential explosions
 * (`(a+)+`, `(a*)*`, `(a|a)+`, `(a|b|ab)*`, `(a{1,3})+`); a legitimate naming convention never needs it.
 *
 * The analysis walks the balanced parentheses, rather than applying a regex to the regex: a regular expression cannot count parentheses,
 * and every earlier attempt therefore let nested groups through — `((a+))+` remains exponential (measured here: 30 characters = ~13 s of
 * blocked event loop).
 */
export function isCatastrophicPattern(pattern: string): boolean {
  const starts: number[] = [];
  let inClass = false;

  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '\\') {
      i++; // escape: the next character is literal
      continue;
    }
    // Inside a class [...], `(`, `|` and the quantifiers are literal.
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
    if (open === undefined) continue; // orphan parenthesis: `new RegExp` will refuse it
    // Is the group quantified? (`*`, `+`, or `{n,}` — `{n}` and `{n,m}` are bounded)
    const after = pattern.slice(i + 1);
    const quantified = /^[*+]/.test(after) || /^\{\d+,\}/.test(after);
    if (!quantified) continue;
    // …and does its body contain enough to produce several parses of the same input?
    if (hasAmbiguityInside(pattern.slice(open + 1, i))) return true;
  }
  return false;
}

/** Does the body of a group carry a quantifier or an alternation (outside a class)? */
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
 * Tests a file name against the project's convention (38.C). An invalid regex, a dangerous pattern, or an `off` mode / empty pattern
 * never hinder the upload (`pass: true`, `mode: 'off'`) — the convention is an aid to rigour, not a security lock.
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

/**
 * Does the instruction given to a ReViewer satisfy the project's rule?
 *
 * Returned rather than thrown: the same rule serves three places — the service, which refuses; the API, which must say *why*; and the screen,
 * which disables the button before even calling. A pure function is the only form that holds all three.
 *
 * Whitespace does not count: the note is compared after `trim`, otherwise five spaces would pass a five-character floor.
 */
export type NoteVerdict = 'ok' | 'missing' | 'too-short';

export function checkReviewNote(note: string | null | undefined, rule: ReviewRequestRule): NoteVerdict {
  const text = (note ?? '').trim();
  if (!text) return rule.requireNote ? 'missing' : 'ok';
  return text.length < rule.minNoteLength ? 'too-short' : 'ok';
}

export const STUDIO_DEFAULTS_KEY = 'project_defaults';

// Safety bounds (shared by the sanitize and the Zod schemas).
const DIM_MIN = 1;
const DIM_MAX = 16384;
const FPS_MIN = 1;
const FPS_MAX = 240;

const EXPOSURE_MIN = 0;
const EXPOSURE_MAX = 10;
const ROTATION_MIN = -180;
const ROTATION_MAX = 180;

/**
 * Bounds of the instruction floor. Five characters by default: enough to rule out "ok" and "see" without demanding a sentence — "lumière"
 * (light) has seven, and that is already an instruction. The ceiling holds a short imposed sentence: beyond it, the studio is no longer asking
 * for an instruction but for a report, and the uploader will write anything to get past it.
 */
const NOTE_MIN_LENGTH_FLOOR = 1;
const NOTE_MIN_LENGTH_CEILING = 280;
export const DEFAULT_NOTE_MIN_LENGTH = 5;

/** Maximum length of a stored instruction — beyond it, it is a review comment. */
export const REVIEW_NOTE_MAX_LENGTH = 2000;

/**
 * An instruction as it arrives: bounded, and erasable (`null`) — "in the end, look at everything". The MINIMUM length is not here: it depends
 * on the project, which only the service knows. Zod bounds what is universal, the service decides the rest.
 */
export const reviewNoteSchema = z.string().max(REVIEW_NOTE_MAX_LENGTH).nullable().optional();

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
  // Nothing is required by default: a studio that never asked for an instruction must not see its publications refused at the first deployment.
  // The floor is set, however — it only serves on the day the studio ticks the box.
  reviewRequest: { requireNote: false, minNoteLength: DEFAULT_NOTE_MIN_LENGTH },
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

/** Received list of departments: keeps only the complete entries. */
function sanitizeDepartments(raw: unknown): Department[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.filter((d): d is Department => !!d && typeof d.key === 'string' && typeof d.name === 'string');
}

/** Received naming, field by field, on a base. */
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
  const reviewRequest = sanitizeReviewRequest(o.reviewRequest, base.reviewRequest);
  // Burn-ins: PARTIAL override kept as-is (known keys, checked types) — the effective resolution (merge with the studio template)
  // is done by lib/burnin.
  const burnin = sanitizeBurninOverride(o.burnin) ?? base.burnin;
  // Default lighting (39.F): absent → inherits from the base; present → cleaned/bounded.
  const defaultLighting = 'defaultLighting' in o ? sanitizeLighting(o.defaultLighting) : base.defaultLighting;
  // OCIO colour (39.B): absent → inherits; present → cleaned.
  const color = 'color' in o ? sanitizeColor(o.color) : base.color;
  return {
    departments,
    nomenclature,
    naming,
    reviewRequest,
    resolution,
    framerate,
    ...(burnin ? { burnin } : {}),
    ...(defaultLighting ? { defaultLighting } : {}),
    ...(color ? { color } : {}),
  };
}

/** Cleans the colour settings (39.B): bounded strings, undefined if empty. */
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

/** Cleans the default lighting (39.F): exposure/rotation bounds, hdriId string, undefined if empty. */
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

/**
 * Cleans the review instruction rule, field by field, on a base.
 *
 * The floor is bounded rather than refused: this setting descends from the studio to dozens of projects, and an inherited aberrant value
 * (`0`, `-1`, `10000`) must not make tagging a ReViewer impossible across a whole production.
 */
function sanitizeReviewRequest(raw: unknown, base: ReviewRequestRule): ReviewRequestRule {
  const o = (raw ?? {}) as Partial<ReviewRequestRule>;
  return {
    requireNote: typeof o.requireNote === 'boolean' ? o.requireNote : base.requireNote,
    minNoteLength: Number.isFinite(o.minNoteLength)
      ? Math.min(
          Math.max(Math.round(Number(o.minNoteLength)), NOTE_MIN_LENGTH_FLOOR),
          NOTE_MIN_LENGTH_CEILING,
        )
      : base.minNoteLength,
  };
}

/** Cleans the naming rule (pattern bounded, mode within the authorised set). */
function sanitizeNaming(raw: unknown, base: NamingRule): NamingRule {
  const o = (raw ?? {}) as Partial<NamingRule>;
  const mode: NamingMode = o.mode === 'warn' || o.mode === 'reject' || o.mode === 'off' ? o.mode : base.mode;
  const pattern = typeof o.pattern === 'string' ? o.pattern.slice(0, 200) : base.pattern;
  // Refused on WRITE, in addition to the runtime guard: an explosive pattern then has no chance of reaching the upload path, and the supervisor
  // sees straight away that their convention is refused — instead of believing it active when it is neutralised.
  if (pattern && isCatastrophicPattern(pattern))
    throw badRequest(
      'Naming pattern rejected: nested quantifier or alternation (the server could stall on it)',
      'NAMING_PATTERN_UNSAFE',
    );
  return { pattern, mode };
}

/** Filters a partial burn-in override (known keys/types only), undefined if empty. */
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
 * Applies a partial pipeline override (JSON of a sequence/shot) on top of a base.
 * Only the fields present and valid are taken into account; the rest inherits from the parent.
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

/** Pipeline (resolution/framerate) extracted from resolved project settings. */
export function pipelineOf(settings: ProjectSettings): PipelineSettings {
  return { resolution: settings.resolution, framerate: settings.framerate };
}

/**
 * Effective pipeline settings of an entity after project → sequence → shot inheritance.
 * Each override (sequence then shot) is a partial JSON applied in order.
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

/** Zod schema of a resolution (shared with the routes). */
export const resolutionSchema = z.object({
  width: z.number().int().min(DIM_MIN).max(DIM_MAX),
  height: z.number().int().min(DIM_MIN).max(DIM_MAX),
});

/** Zod schema of a pipeline override (sequence/shot): optional fields. */
export const pipelineOverrideSchema = z
  .object({
    resolution: resolutionSchema.optional(),
    framerate: z.number().min(FPS_MIN).max(FPS_MAX).optional(),
  })
  .strict();

/** Zod schemas per section — shared between the full write (PUT) and the PATCH. */
const sectionSchemas = {
  departments: z.array(z.object({ key: z.string().min(1).max(40), name: z.string().min(1).max(80) })),
  nomenclature: z.object({
    sequencePrefix: z.string().max(16),
    shotPrefix: z.string().max(16),
    padding: z.number().int().min(1).max(8),
    step: z.number().int().min(1),
  }),
  naming: z.object({ pattern: z.string().max(200), mode: z.enum(['off', 'warn', 'reject']) }),
  reviewRequest: z.object({
    requireNote: z.boolean(),
    minNoteLength: z.number().int().min(NOTE_MIN_LENGTH_FLOOR).max(NOTE_MIN_LENGTH_CEILING),
  }),
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

/** Zod schema of the complete project/studio settings (all optional). */
export const projectSettingsSchema = z.object({
  departments: sectionSchemas.departments.optional(),
  nomenclature: sectionSchemas.nomenclature.optional(),
  naming: sectionSchemas.naming.optional(),
  reviewRequest: sectionSchemas.reviewRequest.optional(),
  resolution: sectionSchemas.resolution.optional(),
  framerate: sectionSchemas.framerate.optional(),
  burnin: sectionSchemas.burnin.optional(),
  defaultLighting: sectionSchemas.defaultLighting.optional(),
  color: sectionSchemas.color.optional(),
});

/**
 * Zod schema of a project settings PATCH: an absent section stays unchanged, a section at `null` returns to the studio inheritance.
 * `.strict()` so that an unknown key is refused rather than silently lost.
 */
export const projectSettingsPatchSchema = z
  .object({
    departments: sectionSchemas.departments.nullable().optional(),
    nomenclature: sectionSchemas.nomenclature.nullable().optional(),
    naming: sectionSchemas.naming.nullable().optional(),
    reviewRequest: sectionSchemas.reviewRequest.nullable().optional(),
    resolution: sectionSchemas.resolution.nullable().optional(),
    framerate: sectionSchemas.framerate.nullable().optional(),
    burnin: sectionSchemas.burnin.nullable().optional(),
    defaultLighting: sectionSchemas.defaultLighting.nullable().optional(),
    color: sectionSchemas.color.nullable().optional(),
  })
  .strict();

/** Studio defaults (Setting.project_defaults), merged with the internal fallback. */
export async function getStudioProjectDefaults(): Promise<ProjectSettings> {
  const row = await prisma.setting.findUnique({ where: { key: STUDIO_DEFAULTS_KEY } });
  if (!row) return FALLBACK;
  try {
    return sanitize(JSON.parse(row.value), FALLBACK);
  } catch {
    return FALLBACK;
  }
}

/** Saves the studio defaults. */
export async function setStudioProjectDefaults(value: unknown): Promise<ProjectSettings> {
  const clean = sanitize(value, FALLBACK);
  await prisma.setting.upsert({
    where: { key: STUDIO_DEFAULTS_KEY },
    update: { value: JSON.stringify(clean) },
    create: { key: STUDIO_DEFAULTS_KEY, value: JSON.stringify(clean) },
  });
  return clean;
}

/** Effective settings of a project: project override on top of the studio defaults. */
export async function resolveProjectSettings(projectSettings: unknown): Promise<ProjectSettings> {
  const studio = await getStudioProjectDefaults();
  return sanitize(projectSettings, studio);
}

/* ------------------------------------------------------------------------------------- *
 *  Override vs effective
 *
 *  The same JSON shape served both: reading returned the effective values (merged with the studio defaults) and writing stored them back
 *  verbatim in `Project.settings`. Opening the settings tab and clicking Save therefore froze the studio's resolution, framerate, naming,
 *  burn-ins, lighting and OCIO into the project: changing a studio default afterwards had no effect, and nothing signalled it.
 *
 *  What follows separates the two readings and gives writes SECTION granularity: an absent section of the project JSON is inherited, a
 *  present section is overridden, and a PATCH with `null` returns it to inheritance.
 * ------------------------------------------------------------------------------------- */

/**
 * Sections of a project override — the write unit of the PATCH and the display unit of the inheritance.
 * `resolution` and `framerate` stay distinct: a project may deliver in 4K at the studio's framerate.
 */
export const SETTINGS_SECTIONS = [
  'resolution',
  'framerate',
  'nomenclature',
  'departments',
  'naming',
  'reviewRequest',
  'defaultLighting',
  'color',
  'burnin',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** What the project actually stores: only the sections it overrides. */
export type ProjectSettingsOverride = Partial<Pick<ProjectSettings, SettingsSection>>;

/** Body of a PATCH: absent section = unchanged, `null` section = return to inheritance. */
export type ProjectSettingsPatch = { [K in SettingsSection]?: ProjectSettings[K] | null };

const SECTION_SET = new Set<string>(SETTINGS_SECTIONS);

/** Is a section value actually supplied (present and non-null)? */
function provided(o: Record<string, unknown>, key: string): boolean {
  return key in o && o[key] !== undefined && o[key] !== null;
}

/**
 * Cleans an override: ONLY the sections present come out, never completed by the studio defaults. This is the difference with `sanitize`,
 * which returns a complete setting. The studio base only serves here to bound the missing fields of a partially filled section.
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
  if (provided(o, 'reviewRequest'))
    out.reviewRequest = sanitizeReviewRequest(o.reviewRequest, studio.reviewRequest);
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

/** Sections actually overridden by the project (the rest is inherited from the studio). */
export function overriddenSections(override: ProjectSettingsOverride): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) => override[section] !== undefined);
}

/**
 * Keys of the stored JSON that are not settings sections (`isTemplate`, notably). They survive any write: the former PUT erased them,
 * the Zod schema knowing none of them.
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
 * Applies a PATCH section by section on a project's stored JSON.
 * Absent section: unchanged · `null` section: removed (return to inheritance) · supplied section: replaced by its cleaned version.
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

/** Replaces the whole override (PUT): only the sections sent remain overridden. */
export function replaceStoredSettings(
  stored: unknown,
  body: unknown,
  studio: ProjectSettings,
): Record<string, unknown> {
  return { ...extraKeys(stored), ...sanitizeOverride(body, studio) };
}

/** A project's override as stored, cleaned (without studio completion). */
export async function resolveProjectOverride(projectSettings: unknown): Promise<ProjectSettingsOverride> {
  const studio = await getStudioProjectDefaults();
  return sanitizeOverride(projectSettings, studio);
}

/**
 * Effective settings of a project from its id (loads the settings column).
 *
 * Departments no longer come from the JSON but from the `Department` table (B1): it is authoritative since they became entities. The rest of
 * the pipe (`lib/pipelineOrder.ts`, the election of the latest version, the display groupings) keeps reading `settings.departments` without
 * knowing where they come from. The JSON is still read as a fallback, while an unmigrated database catches up.
 */
export async function resolveProjectSettingsById(projectId: number): Promise<ProjectSettings> {
  const [project, departments] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { settings: true } }),
    listDepartmentsForProject(projectId),
  ]);
  const base = await resolveProjectSettings(project?.settings ?? {});
  return departments.length > 0 ? { ...base, departments } : base;
}

/** Project departments, otherwise the studio's. Pipe order, upstream → downstream. */
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
