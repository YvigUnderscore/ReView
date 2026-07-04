import { prisma } from './prisma';

/**
 * Réglages projet : départements + nomenclature.
 *
 * Deux niveaux :
 *  - défauts studio (table Setting, clé `project_defaults`, JSON) — appliqués à la
 *    création d'un projet et comme valeurs de repli.
 *  - override par projet (colonne Project.settings, JSON) — prioritaire si présent.
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

export interface ProjectSettings {
  departments: Department[];
  nomenclature: Nomenclature;
}

export const STUDIO_DEFAULTS_KEY = 'project_defaults';

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
};

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
  return { departments, nomenclature };
}

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
