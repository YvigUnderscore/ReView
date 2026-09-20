// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from './prisma';
import { resolveEntitySettings, resolveProjectSettingsById, type Resolution } from './projectSettings';

/**
 * Ratio du cadre de livraison d'un média, hérité des réglages pipeline.
 *
 * POURQUOI. Le cadre de review des médias spatiaux (3D, splat) est letterboxé à un aspect
 * fixe, et son infobulle annonçait depuis le début « hérité des réglages pipeline du shot ».
 * Personne ne le lui servait : l'aspect venait de la présentation caméra enregistrée, qui se
 * contentait de recopier l'aspect… de la caméra, lui-même issu du défaut 16/9. Le premier
 * enregistrement de mise en scène gelait donc 16/9 sans que personne ne l'ait choisi, quelle
 * que soit la résolution de livraison du projet.
 *
 * La résolution, elle, est un réglage pipeline hérité studio → projet → séquence → plan
 * (`resolveEntitySettings`) : c'est elle qui donne le ratio. Le patron est exactement celui
 * de `ImageSequenceService.resolveSequenceFramerate` pour la cadence.
 */

/** Repli : 16:9 — exactement la résolution studio par défaut (1920×1080). */
export const DEFAULT_DELIVERY_ASPECT = 16 / 9;

/**
 * Ratio largeur/hauteur d'une résolution de livraison. Une résolution absente ou aberrante
 * retombe sur le repli plutôt que de produire un `NaN` : un aspect non fini fait un cadre de
 * hauteur nulle à l'écran, c'est-à-dire un viewer vide.
 */
export function aspectOfResolution(resolution: Resolution | null | undefined): number {
  const width = resolution?.width;
  const height = resolution?.height;
  const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (!valid(width) || !valid(height)) return DEFAULT_DELIVERY_ASPECT;
  return width / height;
}

/**
 * Ratio de livraison effectif d'une version : héritage complet studio → projet → séquence →
 * plan. Une version qui ne pend à aucune tâche (donc à aucun plan) prend le ratio du projet.
 */
export async function resolveDeliveryAspect(versionId: number, projectId: number): Promise<number> {
  const [project, version] = await Promise.all([
    resolveProjectSettingsById(projectId),
    prisma.version.findUnique({
      where: { id: versionId },
      select: {
        task: { select: { shot: { select: { settings: true, sequence: { select: { settings: true } } } } } },
      },
    }),
  ]);
  const shot = version?.task?.shot ?? null;
  const pipeline = resolveEntitySettings(project, shot?.sequence?.settings, shot?.settings);
  return aspectOfResolution(pipeline.resolution);
}
