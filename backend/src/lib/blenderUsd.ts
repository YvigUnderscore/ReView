// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';

/**
 * Pilotage de Blender headless pour la conversion USD -> GLB (Phase 45, 45.C).
 *
 * Partie **pure et testable** : construction de la ligne de commande et lecture du resume
 * imprime par `workers/usd/usd_to_glb.py`. L'execution elle-meme vit dans
 * `services/ModelConvertService.ts` (execFile + timeout).
 *
 * Blender ecrit beaucoup de bruit sur stdout (chargement des plugins, statistiques d'export) :
 * le resume est prefixe d'un **marqueur** plutot que devine, sinon la moindre ligne JSON d'un
 * plugin tiers fausserait les metadonnees affichees en fiche technique.
 */

/** Marqueur de la ligne de resume — doit rester identique a `MARKER` dans `usd_to_glb.py`. */
export const BLENDER_SUMMARY_MARKER = 'REVIEW_USD_JSON';

/** Purposes USD exposables en review (`guide` existe mais n'a pas d'interet visuel). */
export const USD_PURPOSES = ['render', 'proxy', 'guide'] as const;
export type UsdPurpose = (typeof USD_PURPOSES)[number];

/** Vrai si la valeur est un purpose USD connu (garde d'entree API). */
export function isUsdPurpose(value: unknown): value is UsdPurpose {
  return typeof value === 'string' && (USD_PURPOSES as readonly string[]).includes(value);
}

export const blenderSummarySchema = z.object({
  objects: z.number().int().nonnegative().default(0),
  meshes: z.number().int().nonnegative().default(0),
  armatures: z.number().int().nonnegative().default(0),
  cameras: z.number().int().nonnegative().default(0),
  materials: z.number().int().nonnegative().default(0),
  images: z.number().int().nonnegative().default(0),
  frameStart: z.number().default(0),
  frameEnd: z.number().default(0),
  fps: z.number().positive().default(24),
  animated: z.boolean().default(false),
  blender: z.string().default(''),
  /** Options de variantes réellement cuites dans le GLB (46.G). */
  variantsBaked: z
    .array(
      z.object({
        prim: z.string(),
        set: z.string(),
        option: z.string(),
        objects: z.number().int().nonnegative().default(0),
      }),
    )
    .default([]),
  /** Options écartées faute de budget — la bascule reste alors une reconversion. */
  variantsSkipped: z.array(z.object({ prim: z.string(), set: z.string(), option: z.string() })).default([]),
});

export type BlenderSummary = z.infer<typeof blenderSummarySchema>;

/** Options de conversion transmises au script Blender. */
export interface BlenderUsdOptions {
  input: string;
  output: string;
  purpose?: UsdPurpose;
  /** Plage de timeCodes issue de l'analyseur — sans elle, l'export retombe sur 1-250. */
  frameStart?: number;
  frameEnd?: number;
  fps?: number;
  /** Force une sortie statique (scene sans animation ou animation non souhaitee). */
  noAnimation?: boolean;
  /** Manifeste JSON des options de variantes a cuire dans le GLB (46.G). */
  variantLayers?: string;
  /** Budget de sommets au-dela duquel les options restantes ne sont plus cuites. */
  variantVertexBudget?: number;
  /** Budget de temps de cuisson (secondes) — la conversion ne doit jamais expirer (46.P). */
  variantTimeBudget?: number;
}

/** Une option de variante a cuire : la couche a importer et le sous-arbre a en conserver. */
export interface VariantLayerEntry {
  /** Couche USD (overlay) selectionnant cette option. */
  stage: string;
  /** Prim porteur du jeu de variantes — seul son sous-arbre est conserve. */
  prim: string;
  set: string;
  option: string;
  /** Option active dans la scene de base, pour etiqueter le sous-arbre d'origine. */
  default: string;
}

/**
 * Arguments complets de `blender` : `-b` (headless — il desactive deja le peripherique audio),
 * `--factory-startup` (aucun addon ni preference utilisateur charges) et `--python-exit-code`
 * (sans lui une exception du script sort en code 0 et l'echec passerait inapercu).
 * Les arguments du script viennent apres le separateur `--`.
 */
export function buildBlenderArgs(scriptPath: string, opts: BlenderUsdOptions): string[] {
  const args = [
    '-b',
    '--factory-startup',
    '--python-exit-code',
    '1',
    '--python',
    scriptPath,
    '--',
    '--input',
    opts.input,
    '--output',
    opts.output,
    '--purpose',
    opts.purpose ?? 'render',
  ];
  const hasRange =
    Number.isFinite(opts.frameStart) &&
    Number.isFinite(opts.frameEnd) &&
    (opts.frameEnd as number) >= (opts.frameStart as number);
  if (hasRange) args.push('--frame-start', String(opts.frameStart), '--frame-end', String(opts.frameEnd));
  if (Number.isFinite(opts.fps) && (opts.fps as number) > 0) args.push('--fps', String(opts.fps));
  if (opts.noAnimation) args.push('--no-animation');
  if (opts.variantLayers) args.push('--variant-layers', opts.variantLayers);
  if (Number.isFinite(opts.variantVertexBudget) && (opts.variantVertexBudget as number) > 0)
    args.push('--variant-vertex-budget', String(opts.variantVertexBudget));
  if (Number.isFinite(opts.variantTimeBudget) && (opts.variantTimeBudget as number) > 0)
    args.push('--variant-time-budget', String(opts.variantTimeBudget));
  return args;
}

/**
 * Extrait le resume de conversion du flot de sortie de Blender. Renvoie `null` si le marqueur
 * est absent : la conversion peut avoir reussi (le GLB est verifie separement) sans que le
 * resume soit exploitable, auquel cas la fiche technique s'en passe.
 */
export function parseBlenderSummary(stdout: string): BlenderSummary | null {
  const line = stdout
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.trimStart().startsWith(BLENDER_SUMMARY_MARKER));
  if (!line) return null;
  const json = line.slice(line.indexOf(BLENDER_SUMMARY_MARKER) + BLENDER_SUMMARY_MARKER.length).trim();
  try {
    const parsed = blenderSummarySchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Message d'erreur court et lisible a partir de la sortie d'erreur de Blender : on ne garde que
 * les dernieres lignes significatives (Blender prefixe ses avertissements de `Warning:`/`Info:`).
 */
export function summarizeBlenderError(stderr: string, fallback = 'erreur inconnue'): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(Info|Warning|Read prefs|found bundled python)/i.test(l));
  return lines.slice(-3).join(' — ').slice(0, 500) || fallback;
}
