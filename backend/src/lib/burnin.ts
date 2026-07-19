import { z } from 'zod';
import { prisma } from './prisma';

/**
 * Burn-ins configurables & slates (35.A) — incrustations FFmpeg posées par le worker sur
 * les proxys/renditions HLS (shot, version, timecode, logo studio, texte libre), et slate
 * d'identification en tête du **dérivé client** (`derived/{id}/client.mp4`) uniquement :
 * un slate en tête du proxy de review décalerait toutes les annotations frame-par-frame.
 *
 * Deux niveaux, comme les réglages pipeline : template studio (Setting `burnin_config`)
 * + override partiel par projet (`Project.settings.burnin`), résolu champ par champ.
 */

export interface BurninConfig {
  enabled: boolean; // incrustations sur proxy + renditions HLS
  showShot: boolean; // code du shot (haut gauche)
  showVersion: boolean; // nom de la version (haut droite)
  showTimecode: boolean; // timecode (bas centre)
  showLogo: boolean; // logo studio (bas droite, overlay)
  customText: string; // texte libre (bas gauche), ex « CONFIDENTIEL »
  slate: boolean; // slate en tête du dérivé client (partages)
}

const BURNIN_KEY = 'burnin_config';

export const BURNIN_FALLBACK: BurninConfig = {
  enabled: false,
  showShot: true,
  showVersion: true,
  showTimecode: true,
  showLogo: false,
  customText: '',
  slate: false,
};

function sanitize(raw: unknown, base: BurninConfig): BurninConfig {
  const o = (raw ?? {}) as Partial<BurninConfig>;
  const bool = (v: unknown, b: boolean) => (typeof v === 'boolean' ? v : b);
  return {
    enabled: bool(o.enabled, base.enabled),
    showShot: bool(o.showShot, base.showShot),
    showVersion: bool(o.showVersion, base.showVersion),
    showTimecode: bool(o.showTimecode, base.showTimecode),
    showLogo: bool(o.showLogo, base.showLogo),
    customText: typeof o.customText === 'string' ? o.customText.slice(0, 120) : base.customText,
    slate: bool(o.slate, base.slate),
  };
}

export const burninConfigSchema = z.object({
  enabled: z.boolean().optional(),
  showShot: z.boolean().optional(),
  showVersion: z.boolean().optional(),
  showTimecode: z.boolean().optional(),
  showLogo: z.boolean().optional(),
  customText: z.string().max(120).optional(),
  slate: z.boolean().optional(),
});

/** Template studio (Setting `burnin_config`). */
export async function getStudioBurninConfig(): Promise<BurninConfig> {
  const row = await prisma.setting.findUnique({ where: { key: BURNIN_KEY } });
  if (!row) return BURNIN_FALLBACK;
  try {
    return sanitize(JSON.parse(row.value), BURNIN_FALLBACK);
  } catch {
    return BURNIN_FALLBACK;
  }
}

/** Enregistre le template studio (validé/borné). */
export async function setStudioBurninConfig(value: unknown): Promise<BurninConfig> {
  const clean = sanitize(value, BURNIN_FALLBACK);
  await prisma.setting.upsert({
    where: { key: BURNIN_KEY },
    update: { value: JSON.stringify(clean) },
    create: { key: BURNIN_KEY, value: JSON.stringify(clean) },
  });
  return clean;
}

/** Config effective d'un projet : override partiel (`Project.settings.burnin`) sur le studio. */
export async function resolveBurninConfig(projectSettings: unknown): Promise<BurninConfig> {
  const studio = await getStudioBurninConfig();
  const override = (projectSettings as { burnin?: unknown } | null)?.burnin;
  return sanitize(override, studio);
}

// ── Construction des filtres FFmpeg (pur, testé) ─────────────────────────────

/**
 * Échappement d'un texte pour `drawtext=text='…'` : les apostrophes deviennent
 * typographiques (pas d'échappement imbriqué fragile), le reste des caractères
 * spéciaux du parser de filtres est précédé d'un antislash.
 */
export function escapeDrawtext(s: string): string {
  return s
    .replace(/'/g, '’')
    .replace(/\\/g, '\\\\')
    .replace(/([:%,;\[\]])/g, '\\$1');
}

export interface BurninContext {
  shotLabel: string | null; // ex « SQ010 · SH020 »
  versionLabel: string | null; // ex « v003 »
  fps: number | null;
}

const text = (t: string, x: string, y: string, size: number) =>
  `drawtext=text='${escapeDrawtext(t)}':x=${x}:y=${y}:fontsize=${size}:fontcolor=white:` +
  `box=1:boxcolor=black@0.35:boxborderw=${Math.max(3, Math.round(size / 4))}`;

/**
 * Filtres drawtext des burn-ins pour une hauteur d'image donnée (fontsize proportionnel).
 * Le logo n'est pas ici (overlay à deux entrées, géré par le worker via filter_complex).
 */
export function buildBurninFilters(cfg: BurninConfig, ctx: BurninContext, height: number): string[] {
  if (!cfg.enabled) return [];
  const size = Math.max(10, Math.round(height / 32));
  const m = Math.max(8, Math.round(height / 60)); // marge
  const out: string[] = [];
  if (cfg.showShot && ctx.shotLabel) out.push(text(ctx.shotLabel, `${m}`, `${m}`, size));
  if (cfg.showVersion && ctx.versionLabel) out.push(text(ctx.versionLabel, `w-tw-${m}`, `${m}`, size));
  if (cfg.customText.trim()) out.push(text(cfg.customText.trim(), `${m}`, `h-th-${m}`, size));
  if (cfg.showTimecode) {
    const rate = Math.min(Math.max(Math.round(ctx.fps ?? 24), 1), 240);
    out.push(
      `drawtext=timecode='00\\:00\\:00\\:00':rate=${rate}:x=(w-tw)/2:y=h-th-${m}:fontsize=${size}:` +
        `fontcolor=white:box=1:boxcolor=black@0.35:boxborderw=${Math.max(3, Math.round(size / 4))}`,
    );
  }
  return out;
}

export interface SlateInfo {
  studioName: string;
  projectName: string | null;
  shotLabel: string | null;
  versionLabel: string | null;
  authorName: string | null;
  fileName: string;
  date: string; // déjà formatée (ex 2026-07-19)
}

/** Lignes du slate (titre puis paires libellé/valeur), sans champ vide. */
export function buildSlateLines(info: SlateInfo): string[] {
  const lines = [info.studioName];
  if (info.projectName) lines.push(`Projet : ${info.projectName}`);
  if (info.shotLabel) lines.push(`Shot : ${info.shotLabel}`);
  if (info.versionLabel) lines.push(`Version : ${info.versionLabel}`);
  if (info.authorName) lines.push(`Artiste : ${info.authorName}`);
  lines.push(`Fichier : ${info.fileName}`, info.date);
  return lines;
}

/**
 * Filtres drawtext du slate : titre en grand, lignes centrées, espacement régulier.
 * Appliqués sur une source `color` aux dimensions du proxy.
 */
export function buildSlateFilters(lines: string[], height: number): string[] {
  const titleSize = Math.max(18, Math.round(height / 14));
  const lineSize = Math.max(12, Math.round(height / 26));
  const gap = Math.round(lineSize * 1.7);
  const startY = Math.round(height * 0.22);
  return lines.map((line, i) => {
    const size = i === 0 ? titleSize : lineSize;
    const y = i === 0 ? startY : startY + titleSize + Math.round(gap * 0.8) + (i - 1) * gap;
    return `drawtext=text='${escapeDrawtext(line)}':x=(w-tw)/2:y=${y}:fontsize=${size}:fontcolor=white`;
  });
}
