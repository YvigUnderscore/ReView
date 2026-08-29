// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PrismaClient, TaskStatus } from '@prisma/client';

/**
 * Vocabulaire de statuts du projet.
 *
 * Il est posé **au niveau projet** et non au niveau studio : c'est la portée qui prime dans
 * la résolution, et cela isole complètement le jeu de démonstration de ce qu'une instance
 * de développement traîne déjà. Chaque entrée porte son pont vers l'énumération figée
 * (`legacyStatus`), sans quoi le kanban et les statistiques ne sauraient plus quoi écrire.
 */

interface StatusDefinition {
  code: string;
  name: string;
  color: string;
  legacyStatus: TaskStatus | null;
  isDone?: boolean;
  isDefault?: boolean;
  isInactive?: boolean;
}

/** Liste complète, par périmètre. L'ordre est celui de la colonne dans le kanban. */
const BY_SCOPE: Record<string, StatusDefinition[]> = {
  task: [
    { code: 'wtg', name: 'Waiting to Start', color: '#8B93A7', legacyStatus: 'TODO', isDefault: true },
    { code: 'rdy', name: 'Ready to Start', color: '#4C8DF6', legacyStatus: 'TODO' },
    { code: 'ip', name: 'In Progress', color: '#F5B841', legacyStatus: 'IN_PROGRESS' },
    { code: 'rev', name: 'Pending Review', color: '#C455D6', legacyStatus: 'PENDING_REVIEW' },
    { code: 'rtk', name: 'Retake', color: '#E74C3C', legacyStatus: 'RETAKE' },
    { code: 'fin', name: 'Final', color: '#2ECC71', legacyStatus: 'APPROVED', isDone: true },
    { code: 'hld', name: 'On Hold', color: '#6B7280', legacyStatus: null, isInactive: true },
    { code: 'omt', name: 'Omitted', color: '#4B5563', legacyStatus: null, isInactive: true },
  ],
  shot: [
    { code: 'rdy', name: 'Ready to Start', color: '#4C8DF6', legacyStatus: 'TODO', isDefault: true },
    { code: 'ip', name: 'In Progress', color: '#F5B841', legacyStatus: 'IN_PROGRESS' },
    { code: 'rev', name: 'Pending Review', color: '#C455D6', legacyStatus: 'PENDING_REVIEW' },
    { code: 'rtk', name: 'Retake', color: '#E74C3C', legacyStatus: 'RETAKE' },
    { code: 'fin', name: 'Final', color: '#2ECC71', legacyStatus: 'APPROVED', isDone: true },
    { code: 'hld', name: 'On Hold', color: '#6B7280', legacyStatus: null, isInactive: true },
    { code: 'omt', name: 'Omitted', color: '#4B5563', legacyStatus: null, isInactive: true },
  ],
  sequence: [
    { code: 'rdy', name: 'Ready to Start', color: '#4C8DF6', legacyStatus: 'TODO', isDefault: true },
    { code: 'ip', name: 'In Progress', color: '#F5B841', legacyStatus: 'IN_PROGRESS' },
    { code: 'fin', name: 'Final', color: '#2ECC71', legacyStatus: 'APPROVED', isDone: true },
    { code: 'hld', name: 'On Hold', color: '#6B7280', legacyStatus: null, isInactive: true },
    { code: 'omt', name: 'Omitted', color: '#4B5563', legacyStatus: null, isInactive: true },
  ],
  asset: [
    { code: 'rdy', name: 'Ready to Start', color: '#4C8DF6', legacyStatus: 'TODO', isDefault: true },
    { code: 'ip', name: 'In Progress', color: '#F5B841', legacyStatus: 'IN_PROGRESS' },
    { code: 'rev', name: 'Pending Review', color: '#C455D6', legacyStatus: 'PENDING_REVIEW' },
    { code: 'fin', name: 'Final', color: '#2ECC71', legacyStatus: 'APPROVED', isDone: true },
    { code: 'hld', name: 'On Hold', color: '#6B7280', legacyStatus: null, isInactive: true },
  ],
};

/** `scope:code` → identifiant du statut. */
export type StatusMap = Map<string, number>;

export async function seedPipelineStatuses(prisma: PrismaClient, projectId: number): Promise<StatusMap> {
  const map: StatusMap = new Map();
  for (const [scope, definitions] of Object.entries(BY_SCOPE)) {
    for (const [order, definition] of definitions.entries()) {
      const existing = await prisma.pipelineStatus.findFirst({
        where: { projectId, scope, code: definition.code, origin: 'local' },
      });
      const data = {
        name: definition.name,
        color: definition.color,
        order,
        isDone: definition.isDone ?? false,
        isDefault: definition.isDefault ?? false,
        isInactive: definition.isInactive ?? false,
        legacyStatus: definition.legacyStatus,
      };
      const record = existing
        ? await prisma.pipelineStatus.update({ where: { id: existing.id }, data })
        : await prisma.pipelineStatus.create({
            data: { projectId, scope, code: definition.code, origin: 'local', ...data },
          });
      map.set(`${scope}:${definition.code}`, record.id);
    }
  }
  return map;
}

/** Statut d'un périmètre, ou celui par défaut si le code n'existe pas dans ce périmètre. */
export function statusId(map: StatusMap, scope: string, code: string): number | null {
  return map.get(`${scope}:${code}`) ?? map.get(`${scope}:ip`) ?? null;
}
