// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { planDrop, sendPlan } from './useSequenceUploadStore';
import { withUploadNote } from './useUploadNoteStore';

/**
 * Point d'entrée unique de tout dépôt de fichiers destiné à une version.
 *
 * Les quatre endroits d'où l'on livre (fiche d'asset, de plan, de tâche, timeline de
 * versions) passent par ici et nulle part ailleurs : c'est ce qui garantit qu'un plan livré
 * en mille frames EXR devient UN média et non mille, et qu'aucun dépôt n'échappe à la
 * consigne exigée par le projet.
 *
 * L'ordre est délibéré : regroupement, puis consigne, puis seulement la cible. `target`
 * reçoit l'envoi tout prêt et décide de la version — en la créant au besoin. Renoncer à
 * l'un ou l'autre dialogue ne crée donc rien, pas même une version vide.
 */
export async function deliverFiles(
  projectId: number | null | undefined,
  files: File[],
  target: (send: (versionId: number) => void) => void | Promise<void>,
): Promise<void> {
  if (files.length === 0) return;
  const plan = await planDrop(files);
  if (!plan) return;
  await withUploadNote(projectId, (note) => target((versionId) => sendPlan(plan, versionId, note)));
}
