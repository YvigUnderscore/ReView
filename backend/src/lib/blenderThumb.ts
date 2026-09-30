// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';

/**
 * Pilotage de Blender headless pour le **rendu de vignette** d'un modèle 3D.
 *
 * Même partage des rôles que `lib/blenderUsd` : ici la partie pure et testable (ligne de
 * commande, lecture du résumé) ; l'exécution vit dans `services/ModelConvertService`.
 *
 * Le moteur est **Cycles sur CPU**, jamais EEVEE : depuis Blender 4.2, EEVEE Next exige un
 * GPU exposant OpenGL 4.3, ce que l'image Docker du worker n'a pas. Un rendu EEVEE y échoue
 * ou, pire, sort une image noire. Cycles CPU est lent mais donne toujours la même image,
 * partout — et 512 px à quelques dizaines d'échantillons se rend en secondes.
 */

/** Marqueur du résumé — doit rester identique à `MARKER` dans `workers/usd/render_thumb.py`. */
export const BLENDER_THUMB_MARKER = 'REVIEW_THUMB_JSON';

/** Côté de la vignette rendue. */
export const BLENDER_THUMB_SIZE = 512;

/** Échantillons Cycles : au-delà, le débruiteur ne gagne plus rien sur une vignette. */
export const BLENDER_THUMB_SAMPLES = 24;

/**
 * Délai maximal du rendu — même motif que `lib/ffmpegTimeout` : un processus qui n'avance
 * plus immobilise l'emplacement de la file, et rien ne le signale. Dix minutes couvrent
 * largement 512 px à 24 échantillons sur CPU, même pour une scène lourde.
 */
export const BLENDER_THUMB_TIMEOUT_MS = 10 * 60_000;

/** Motif de non-rendu à journaliser quand le délai est dépassé (le processus est tué). */
export const blenderThumbTimeoutReason = (timeoutMs: number): string =>
  `timeout:${Math.round(timeoutMs / 1000)}s`;

export const blenderThumbSummarySchema = z.object({
  rendered: z.boolean().default(false),
  /** Motif de non-rendu (`no-geometry`, `import-failed`…), pour le journal du worker. */
  reason: z.string().default(''),
  objects: z.number().int().nonnegative().default(0),
  blender: z.string().default(''),
});

export type BlenderThumbSummary = z.infer<typeof blenderThumbSummarySchema>;

export interface BlenderThumbOptions {
  /** GLB à rendre (le dérivé de conversion, ou le fichier d'origine s'il est déjà GLB). */
  input: string;
  /** PNG produit (fond transparent). */
  output: string;
  size?: number;
  samples?: number;
}

/**
 * Arguments complets de `blender`. `--python-exit-code 1` est indispensable : sans lui une
 * exception du script sort en code 0 et l'échec passerait pour un succès sans image.
 */
export function buildThumbArgs(scriptPath: string, opts: BlenderThumbOptions): string[] {
  return [
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
    '--size',
    String(Math.max(32, Math.round(opts.size ?? BLENDER_THUMB_SIZE))),
    '--samples',
    String(Math.max(1, Math.round(opts.samples ?? BLENDER_THUMB_SAMPLES))),
  ];
}

/**
 * Extrait le résumé du flot de sortie de Blender (très bavard). Renvoie `null` si le marqueur
 * est absent : on ne devine pas, l'appelant se rabat sur l'existence du fichier produit.
 */
export function parseThumbSummary(stdout: string): BlenderThumbSummary | null {
  const line = stdout
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.trimStart().startsWith(BLENDER_THUMB_MARKER));
  if (!line) return null;
  const json = line.slice(line.indexOf(BLENDER_THUMB_MARKER) + BLENDER_THUMB_MARKER.length).trim();
  try {
    const parsed = blenderThumbSummarySchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
